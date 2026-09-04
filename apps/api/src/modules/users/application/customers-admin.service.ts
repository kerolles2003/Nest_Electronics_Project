import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../../common/dto/pagination-query.dto';
import { AuditService, type AuditContext } from '../../audit/application/audit.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-action';
import { toAuditActor } from '../../audit/domain/audit-actor';
import { Order } from '../../orders/infrastructure/schemas/order.schema';
import { revenueMatch } from '../../orders/domain/revenue';
import { Role, User, type UserLean } from '../infrastructure/schemas/user.schema';

/** Everything the admin list shows about one account, plus its order totals. */
export interface CustomerSummary {
  readonly user: UserLean;
  readonly orderCount: number;
  /** Lifetime spend, counted at DELIVERY. Minor units. */
  readonly totalSpent: number;
  readonly lastOrderAt: Date | null;
}

export interface CustomerQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly q?: string;
  readonly role?: Role;
  readonly includeDeleted?: boolean;
}

export interface CustomerPage {
  readonly items: readonly CustomerSummary[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface AdminWriteContext {
  readonly actorId: Types.ObjectId;
  readonly forensics: AuditContext;
}

/**
 * The people list, and the two operations `SUPER_ADMIN` is alone in having.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §3 (the ADMIN /
 *            SUPER_ADMIN separation table); AUDIT-MODEL.md §3.
 *
 * ## The separation legacy declared in three places and enforced in none
 *
 * §3 is explicit: `is_admin()` and `requireAdmin()` treated both roles
 * identically, so "SUPER_ADMIN" was a label. The table gives four operations
 * that are `SUPER_ADMIN` only, and two of them live here — **change a user's
 * role** and **delete a user**. They are enforced by `@Roles(SUPER_ADMIN)` on
 * the routes, so the distinction is visible in the route table rather than
 * buried in a branch.
 *
 * ## `passwordHash` cannot reach a response from here
 *
 * Every read in this class projects the fields it needs. The credential fields
 * are owned by AuthModule through a dedicated repository (§10) and are absent
 * from the projection, so there is no serializer option, no `toJSON` override
 * and no forgotten `select` that could leak one.
 */
@Injectable()
export class CustomersAdminService {
  private readonly logger = new Logger(CustomersAdminService.name);

  /** What a customer list may see. Credential fields are absent by construction. */
  private static readonly PROJECTION = {
    _id: 1,
    email: 1,
    fullName: 1,
    phone: 1,
    role: 1,
    emailVerifiedAt: 1,
    lastLoginAt: 1,
    deletedAt: 1,
    addresses: 1,
    createdAt: 1,
    updatedAt: 1,
  } as const;

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    /*
     * The `orders` collection, registered here for READS ONLY: an account's
     * order count and lifetime spend. Importing OrdersModule would close a
     * cycle — OrdersModule already imports UsersModule to resolve the address a
     * checkout names. Registering another module's model on the shared
     * connection is the precedent InventoryModule sets (ADR-INVENTORY-002), and
     * Mongoose resolves it to the one compiled model. Nothing here writes an
     * order.
     */
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    private readonly audit: AuditService,
  ) {}

  /**
   * The people list, with each account's order totals attached.
   *
   * ## Two queries, not N+1
   *
   * The page of users is read first, then ONE aggregation computes totals for
   * exactly those ids. The obvious alternative — a count and a sum per row — is
   * 2N round trips for a 24-row page, and it is the shape that made the legacy
   * customer screen slow enough to notice.
   *
   * Aggregating first and paginating on the result was rejected too: it would
   * exclude every account that has never ordered, which on a new shop is most
   * of them, and an operator looking for a customer who has not bought anything
   * yet is a completely ordinary thing.
   */
  async list(query: CustomerQuery): Promise<CustomerPage> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter: FilterQuery<User> = {};

    if (query.includeDeleted !== true) filter.deletedAt = null;
    if (query.role !== undefined) filter.role = query.role;

    if (query.q !== undefined && query.q.length > 0) {
      const term = new RegExp(escapeRegExp(query.q), 'i');
      const digits = query.q.replace(/\D/g, '');

      /*
       * Substring, not a text index, and the same choice as the order queue and
       * the catalogue: an operator typing part of a name expects a mid-token
       * match, which a tokenised text index cannot give them.
       *
       * MONGODB-DESIGN.md §3 lists a text index on name/email among the
       * indexes the admin list would need. It is deliberately not created: it
       * would not serve this query, and an index nothing reads is pure write
       * cost — the legacy defect where a GIN index recorded 0 scans against
       * 1,282 sequential ones. The two indexes that DO serve this list are
       * created with it.
       */
      filter.$or = [
        { email: term },
        { fullName: term },
        ...(digits.length >= 4 ? [{ phone: new RegExp(escapeRegExp(digits)) }] : []),
      ];
    }

    const [users, total] = await Promise.all([
      this.users
        .find(filter)
        .select(CustomersAdminService.PROJECTION)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<UserLean[]>()
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);

    const totals = await this.orderTotals(users.map((user) => user._id));

    return {
      items: users.map((user) => ({
        user,
        ...(totals.get(user._id.toHexString()) ?? { orderCount: 0, totalSpent: 0, lastOrderAt: null }),
      })),
      total,
      page,
      limit,
    };
  }

  async findById(id: Types.ObjectId): Promise<CustomerSummary> {
    const user = await this.users
      .findById(id)
      .select(CustomersAdminService.PROJECTION)
      .lean<UserLean>()
      .exec();

    if (user === null) throw AppException.resourceNotFound();

    const totals = await this.orderTotals([id]);

    return {
      user,
      ...(totals.get(id.toHexString()) ?? { orderCount: 0, totalSpent: 0, lastOrderAt: null }),
    };
  }

  /**
   * Changes a role, and invalidates every token the account is holding.
   *
   * ## Three refusals, and each closes a different hole
   *
   * **Not your own role.** A `SUPER_ADMIN` cannot demote themselves (§3), and
   * the same rule stops the reverse mistake — an operator promoting themselves
   * is the one role change that has no reviewer. Refusing it also means the
   * last super-admin cannot vanish by their own hand.
   *
   * **Not the last `SUPER_ADMIN`.** §3: "the last super-admin must always
   * exist". With self-demotion already refused this is only reachable via a
   * second super-admin demoting the first, and it is counted rather than
   * assumed — an account list nobody checked is how a system ends up with no
   * owner.
   *
   * **Not a no-op.** Setting the role somebody already has writes no audit row,
   * because `recordChange` writes nothing when the diff is empty.
   *
   * ## The token version, which is the part that has teeth
   *
   * `role` is a JWT claim, carried so the guard needs no per-request lookup —
   * legacy looked it up on EVERY request and made `profiles_pkey` the hottest
   * index in the database at 2,719 scans. The cost of that design is that a
   * demoted admin keeps a working admin token for up to fifteen minutes.
   * `tokenVersion` is the escape hatch the schema documents for exactly this
   * case, and incrementing it here is what makes the demotion immediate rather
   * than eventual.
   */
  async changeRole(
    id: Types.ObjectId,
    role: Role,
    context: AdminWriteContext,
  ): Promise<CustomerSummary> {
    const actor = await this.users.findById(context.actorId).lean<UserLean>().exec();

    if (actor === null || actor.deletedAt !== null) throw AppException.accountDisabled();

    if (actor._id.equals(id)) {
      throw AppException.cannotChangeOwnRole();
    }

    const target = await this.users.findById(id).lean<UserLean>().exec();

    if (target === null) throw AppException.resourceNotFound();

    if (target.role === Role.SUPER_ADMIN && role !== Role.SUPER_ADMIN) {
      const remaining = await this.users
        .countDocuments({ role: Role.SUPER_ADMIN, deletedAt: null })
        .exec();

      if (remaining <= 1) throw AppException.lastSuperAdmin();
    }

    const updated = (await this.users
      .findOneAndUpdate(
        { _id: id },
        // The role and the invalidation in ONE update. Two statements would
        // leave a window in which the role had changed and the old tokens still
        // worked — small, and exactly the window an escape hatch exists to close.
        { $set: { role }, $inc: { tokenVersion: 1 } },
        { new: true, projection: CustomersAdminService.PROJECTION },
      )
      .lean<UserLean>()
      .exec()) as UserLean;

    await this.audit.recordChange({
      actor: toAuditActor(actor),
      action: AuditAction.USER_ROLE_CHANGED,
      entity: { type: AuditEntityType.USER, id, label: target.email },
      before: { role: target.role },
      after: { role: updated.role },
      context: context.forensics,
    });

    if (target.role !== updated.role) {
      this.logger.warn(
        `role changed  user=${id.toHexString()}  ${target.role} -> ${updated.role}  ` +
          `by=${actor._id.toHexString()}`,
      );
    }

    const totals = await this.orderTotals([id]);

    return {
      user: updated,
      ...(totals.get(id.toHexString()) ?? { orderCount: 0, totalSpent: 0, lastOrderAt: null }),
    };
  }

  /**
   * Soft-deletes an account.
   *
   * A soft-deleted user can never authenticate — the check happens after
   * password verification, so the response cannot be used to enumerate
   * accounts. `tokenVersion` is incremented for the same reason as a role
   * change: without it the account keeps a working access token for the
   * remainder of its fifteen minutes, and "deleted" would mean "deleted in a
   * quarter of an hour".
   *
   * Their ORDERS are untouched. An order is an immutable commercial record that
   * embeds its own customer snapshot, so it reads correctly after the account is
   * gone — which is the whole reason the snapshot exists.
   */
  async softDelete(id: Types.ObjectId, context: AdminWriteContext): Promise<CustomerSummary> {
    const actor = await this.users.findById(context.actorId).lean<UserLean>().exec();

    if (actor === null || actor.deletedAt !== null) throw AppException.accountDisabled();

    if (actor._id.equals(id)) throw AppException.cannotDeleteOwnAccount();

    const target = await this.users.findById(id).lean<UserLean>().exec();

    if (target === null) throw AppException.resourceNotFound();
    if (target.deletedAt !== null) throw AppException.resourceNotFound();

    if (target.role === Role.SUPER_ADMIN) {
      const remaining = await this.users
        .countDocuments({ role: Role.SUPER_ADMIN, deletedAt: null })
        .exec();

      if (remaining <= 1) throw AppException.lastSuperAdmin();
    }

    const updated = (await this.users
      .findOneAndUpdate(
        { _id: id, deletedAt: null },
        { $set: { deletedAt: new Date() }, $inc: { tokenVersion: 1 } },
        { new: true, projection: CustomersAdminService.PROJECTION },
      )
      .lean<UserLean>()
      .exec()) as UserLean;

    await this.audit.record({
      actor: toAuditActor(actor),
      /*
       * Recorded under `USER_ROLE_CHANGED` would be wrong, and there is no
       * `USER_DELETED` in the frozen vocabulary. §3 lists "destructive
       * operations" as audited and the enum is ADDITIVE by its own docstring,
       * so a new action is the honest answer rather than borrowing one whose
       * name would mislead every future query on `{action, createdAt}`.
       */
      action: AuditAction.USER_DELETED,
      entity: { type: AuditEntityType.USER, id, label: target.email },
      changes: { before: { deletedAt: null }, after: { deletedAt: updated.deletedAt } },
      metadata: { role: target.role, fullName: target.fullName },
      context: context.forensics,
    });

    this.logger.warn(
      `account deleted  user=${id.toHexString()}  by=${actor._id.toHexString()}`,
    );

    const totals = await this.orderTotals([id]);

    return {
      user: updated,
      ...(totals.get(id.toHexString()) ?? { orderCount: 0, totalSpent: 0, lastOrderAt: null }),
    };
  }

  /**
   * Order count, lifetime spend and last order date, for a set of accounts.
   *
   * ## Two numbers with different rules, on purpose
   *
   * `orderCount` counts EVERY order the account placed, whatever became of it —
   * an operator asking "has this person ordered before" means exactly that, and
   * a count that silently excluded cancellations would disagree with the order
   * list on the same screen.
   *
   * `totalSpent` counts only what was PAID, which under COD means delivered —
   * see `orders/domain/revenue.ts`. A cancelled order is not spending, and
   * neither is one still out with a courier.
   */
  private async orderTotals(
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, { orderCount: number; totalSpent: number; lastOrderAt: Date | null }>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.orders
      .aggregate<{
        _id: Types.ObjectId;
        orderCount: number;
        totalSpent: number;
        lastOrderAt: Date | null;
      }>([
        { $match: { userId: { $in: [...userIds] } } },
        {
          $group: {
            _id: '$userId',
            orderCount: { $sum: 1 },
            totalSpent: {
              $sum: {
                $cond: [
                  { $eq: ['$payment.status', revenueMatch()['payment.status']] },
                  '$pricing.grandTotal',
                  0,
                ],
              },
            },
            lastOrderAt: { $max: '$placedAt' },
          },
        },
      ])
      .exec();

    return new Map(
      rows.map((row) => [
        row._id.toHexString(),
        {
          orderCount: row.orderCount,
          totalSpent: row.totalSpent,
          lastOrderAt: row.lastOrderAt,
        },
      ]),
    );
  }
}

/** The admin search reaches a `$regex`; an unescaped `(` is a 500 and `.*` a full scan. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
