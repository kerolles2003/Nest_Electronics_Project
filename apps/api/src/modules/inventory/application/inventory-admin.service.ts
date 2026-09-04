import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../../common/dto/pagination-query.dto';
import { TransactionService } from '../../../database/transaction.service';
import { AuditService, type AuditContext } from '../../audit/application/audit.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-action';
import { toAuditActor } from '../../audit/domain/audit-actor';
import { Product, type ProductLean } from '../../catalog/infrastructure/schemas/product.schema';
import { UsersService, type UserProfile } from '../../users/application/users.service';
import { InventoryRepository } from '../infrastructure/repositories/inventory.repository';
import {
  InventoryEvent,
  InventoryEventType,
} from '../infrastructure/schemas/inventory-event.schema';

/**
 * The event types an OPERATOR may write directly.
 *
 * Authority: INVENTORY-MODEL.md §5.3 and §5.4.
 *
 * `SALE`, `CANCELLATION` and `RETURN` are absent because they are consequences
 * of an order, written inside the order's own transaction — an operator able to
 * hand-write a `SALE` could move stock without an order existing, and the
 * ledger would stop being reconcilable against `orders`.
 *
 * `OPENING_BALANCE` is absent for a different reason: §9 makes initial stock a
 * SEED, "not a migration". An opening balance an operator can post at any time
 * is not an opening balance; it is an adjustment claiming to be one, and
 * reporting that distinguishes the two would then be lying.
 */
export const OPERATOR_EVENT_TYPES = [
  InventoryEventType.RESTOCK,
  InventoryEventType.ADJUSTMENT,
  InventoryEventType.DAMAGE,
] as const;

export type OperatorEventType = (typeof OPERATOR_EVENT_TYPES)[number];

export interface AdjustStockCommand {
  readonly productId: Types.ObjectId;
  /** Non-zero, signed. Negative removes stock. */
  readonly delta: number;
  readonly reason: string;
  readonly type: OperatorEventType;
  readonly actorId: Types.ObjectId;
  readonly forensics: AuditContext;
}

export interface StockLevelQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly q?: string;
  readonly lowStock?: boolean;
  readonly outOfStock?: boolean;
  readonly categoryId?: string;
  readonly includeInactive?: boolean;
}

export interface StockLevelPage {
  readonly items: readonly ProductLean[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface AdjustmentOutcome {
  readonly product: ProductLean;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}

/** One product whose ledger does not add up to its stock. */
export interface ReconciliationDiscrepancy {
  readonly productId: string;
  readonly sku: string;
  readonly onHand: number;
  readonly ledgerSum: number;
  readonly difference: number;
}

export interface ReconciliationReport {
  readonly checked: number;
  readonly discrepancies: readonly ReconciliationDiscrepancy[];
}

/**
 * Stock operations an operator performs, and the reports that make them
 * checkable.
 *
 * Authority: docs/architecture/INVENTORY-MODEL.md §5.3, §5.4, §6, §7;
 *            AUDIT-MODEL.md §3.
 *
 * ## Separate from `InventoryService`, and for a reason with teeth
 *
 * `InventoryService` holds `commitSale` and `restoreStock`: both take a session
 * from the CALLER, because both are steps inside an order's transaction and
 * must commit or abort with it. Neither may open a transaction of its own.
 *
 * This class is the opposite. An adjustment is its own unit of work with no
 * surrounding order, so it OWNS its transaction. Merging the two would produce
 * methods that sometimes open a transaction and sometimes join one, decided by
 * whether an argument was null — which is exactly the ambiguity that lets a
 * ledger write end up outside the transaction that moved the stock. Legacy's
 * ledger was written by a different code path than the stock update, and the
 * two diverged.
 *
 * ## Why zero adjustments have ever been recorded
 *
 * §5.3's evidence line: "zero `adjustment` events exist, so `adjust_stock_v2`
 * never once completed successfully in production." The semantics below are
 * preserved from it because they were well designed — a signed delta, a
 * required reason, a floor at zero. The execution path is new because the old
 * one never worked.
 */
@Injectable()
export class InventoryAdminService {
  private readonly logger = new Logger(InventoryAdminService.name);

  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(InventoryEvent.name) private readonly events: Model<InventoryEvent>,
    private readonly inventory: InventoryRepository,
    private readonly transactions: TransactionService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Moves stock by a signed delta and writes the matching ledger entry, both
   * inside one transaction.
   *
   * ## The order of the two writes does not matter; the transaction does
   *
   * Either both land or neither does. That is what makes
   * `Σ quantityDelta == stock.onHand` an invariant rather than an aspiration,
   * and it is the single thing legacy's inventory lacked: its ledger was
   * decorative because a different code path wrote it.
   *
   * ## The actor comes from the token, never from the body
   *
   * §5.3: "Actor — from the JWT, **never** a request parameter (fixes the
   * legacy `p_admin_id` forgery vector)". The DTO has no actor field, so there
   * is no request shape that could carry one; the role and name are read from
   * the database profile rather than the JWT claim, because a token minted
   * before a demotion still carries the old role.
   */
  async adjust(command: AdjustStockCommand): Promise<AdjustmentOutcome> {
    const actor = await this.resolveActor(command.actorId);

    if (command.delta === 0) {
      // §5.3, and legacy defect F-MED-9: a zero delta is a ledger row that
      // records nothing happening. The ledger's value is that every row is a
      // movement.
      throw AppException.validation([
        {
          field: 'delta',
          message: 'delta must not be zero — an adjustment that moves nothing is not an event.',
          code: 'NON_ZERO',
        },
      ]);
    }

    const product = await this.products
      .findById(command.productId)
      .lean<ProductLean>()
      .exec();

    if (product === null) throw AppException.productNotFound();

    const outcome = await this.transactions.run(async (session) => {
      const moved = await this.inventory.adjust(command.productId, command.delta, session);

      if (moved === null) {
        /*
         * The update matched nothing. Ask the database WHY rather than
         * inferring it from a value read before the write — that inference is
         * the race this design exists to close. The only two answers are "gone"
         * and "the floor refused it", and a manual adjustment does not filter
         * on visibility, so `UNAVAILABLE` cannot be the reason here.
         */
        const refusal = await this.inventory.diagnose(command.productId, session);

        if (refusal.reason === 'MISSING') throw AppException.productNotFound();

        throw AppException.insufficientStockForAdjustment(refusal.available, command.delta);
      }

      await this.inventory.recordEvents(
        [
          {
            productId: command.productId,
            // Snapshotted, so the ledger reads standalone after a rename or a
            // hard delete.
            sku: product.sku,
            type: command.type,
            quantityDelta: command.delta,
            balanceBefore: moved.balanceBefore,
            balanceAfter: moved.balanceAfter,
            reason: command.reason,
            // No reference: an adjustment points at no order. The unique index
            // on `{reference.id, productId, type}` is PARTIAL on `reference.id`
            // existing precisely so many of these do not collide.
            reference: null,
            actor: { id: actor._id, role: actor.role, name: actor.fullName },
          },
        ],
        session,
      );

      return moved;
    });

    const updated = (await this.products
      .findById(command.productId)
      .lean<ProductLean>()
      .exec()) as ProductLean;

    /*
     * POST-COMMIT and outside the transaction, per AUDIT-MODEL.md §5 rule 2.
     * §3 is explicit that this is written IN ADDITION to the ledger, not
     * instead of it: the ledger records what moved, the audit records who, and
     * why they were allowed to.
     */
    await this.audit.record({
      actor: toAuditActor(actor),
      action: AuditAction.INVENTORY_ADJUSTED,
      entity: { type: AuditEntityType.PRODUCT, id: command.productId, label: product.sku },
      changes: {
        before: { 'stock.onHand': outcome.balanceBefore },
        after: { 'stock.onHand': outcome.balanceAfter },
      },
      metadata: { type: command.type, delta: command.delta, reason: command.reason },
      context: command.forensics,
    });

    this.logger.log(
      `stock adjusted  sku=${product.sku}  ${command.type}  ${command.delta > 0 ? '+' : ''}` +
        `${String(command.delta)}  ${String(outcome.balanceBefore)} -> ${String(outcome.balanceAfter)}  ` +
        `by=${actor._id.toHexString()}`,
    );

    return { product: updated, balanceBefore: outcome.balanceBefore, balanceAfter: outcome.balanceAfter };
  }

  /**
   * Stock levels, with the two reports §7 names as filters rather than as
   * separate endpoints.
   *
   * "Low stock" and "out of stock" are the same list with a different
   * predicate, and an operator moves between them constantly. Two endpoints
   * would duplicate the search, the pagination and the sort to vary one filter.
   *
   * Low stock is per-product: `onHand <= lowStockThreshold`, not a global
   * constant. A reel of resistors and an oscilloscope do not reorder at the
   * same number. Legacy loaded EVERY product and filtered in JavaScript
   * (Phase 0 P3); this is a database predicate.
   */
  async levels(query: StockLevelQuery): Promise<StockLevelPage> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter: FilterQuery<Product> = { deletedAt: null };

    if (query.includeInactive !== true) filter.isActive = true;
    if (query.categoryId !== undefined) filter['category.path'] = new Types.ObjectId(query.categoryId);
    if (query.outOfStock === true) filter['stock.onHand'] = 0;
    if (query.lowStock === true) {
      filter.$expr = { $lte: ['$stock.onHand', '$stock.lowStockThreshold'] };
    }

    if (query.q !== undefined && query.q.length > 0) {
      const term = new RegExp(escapeRegExp(query.q), 'i');

      filter.$or = [{ sku: term }, { 'name.en': term }];
    }

    const [items, total] = await Promise.all([
      this.products
        // Scarcest first: the list exists to be acted on, and the thing an
        // operator wants at the top is what runs out next.
        .find(filter)
        .sort({ 'stock.onHand': 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<ProductLean[]>()
        .exec(),
      this.products.countDocuments(filter).exec(),
    ]);

    return { items, total, page, limit };
  }

  /** Movement history for one product, newest first. */
  async history(
    productId: Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<{ items: InventoryEvent[]; total: number }> {
    const product = await this.products.exists({ _id: productId }).exec();

    // A history for a product that never existed is an empty page that looks
    // like a product with no movements. They are different facts.
    if (product === null) throw AppException.productNotFound();

    const filter = { productId };

    const [items, total] = await Promise.all([
      this.events
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<InventoryEvent[]>()
        .exec(),
      this.events.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  /**
   * The reconciliation §7 calls "New. Impossible in legacy."
   *
   * For every product with ledger history, `Σ quantityDelta` must equal
   * `stock.onHand`. A difference proves an out-of-band mutation — something
   * moved stock without writing an event, or wrote an event without moving
   * stock. Both are the failure this module's whole design exists to prevent,
   * and neither is detectable any other way.
   *
   * ## It REPORTS. It does not correct.
   *
   * Same rule as the media reconciliation, for the same reason: an automated
   * corrector that misreads state writes a wrong number into the only record
   * anyone could have used to find the right one. An operator posts an
   * `ADJUSTMENT` with a reason, which leaves a trail.
   *
   * ## The caveat that has to be stated
   *
   * A product seeded with stock and no `OPENING_BALANCE` event reconciles as a
   * discrepancy equal to its whole balance, because the ledger genuinely does
   * not account for it. That is not a false positive — it is the seed's
   * omission, correctly reported. §9 makes initial stock a seed, and a seed
   * that skips the opening event leaves exactly this gap.
   */
  async reconcile(limit = 100): Promise<ReconciliationReport> {
    const sums = await this.events
      .aggregate<{ _id: Types.ObjectId; ledgerSum: number }>([
        { $group: { _id: '$productId', ledgerSum: { $sum: '$quantityDelta' } } },
      ])
      .exec();

    if (sums.length === 0) return { checked: 0, discrepancies: [] };

    const products = await this.products
      .find({ _id: { $in: sums.map((row) => row._id) } })
      .select({ sku: 1, 'stock.onHand': 1 })
      .lean<{ _id: Types.ObjectId; sku: string; stock: { onHand: number } }[]>()
      .exec();

    const byId = new Map(products.map((product) => [product._id.toHexString(), product]));
    const discrepancies: ReconciliationDiscrepancy[] = [];

    for (const row of sums) {
      const product = byId.get(row._id.toHexString());

      // A ledger for a product that no longer exists. Only a hard delete
      // produces this, and the events are deliberately left behind — they are
      // the record of stock that genuinely moved.
      if (product === undefined) continue;

      const difference = product.stock.onHand - row.ledgerSum;

      if (difference !== 0) {
        discrepancies.push({
          productId: product._id.toHexString(),
          sku: product.sku,
          onHand: product.stock.onHand,
          ledgerSum: row.ledgerSum,
          difference,
        });
      }
    }

    return { checked: sums.length, discrepancies: discrepancies.slice(0, limit) };
  }

  private async resolveActor(actorId: Types.ObjectId): Promise<UserProfile> {
    const profile = await this.users.findById(actorId);

    if (profile === null) throw AppException.accountDisabled();

    return profile;
  }
}

/** The admin search reaches a `$regex`; an unescaped `(` is a 500 and `.*` a full scan. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
