import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../../../common/dto/pagination-query.dto';
import { AuditAction, AuditEntityType } from '../domain/audit-action';
import { AuditLog, type AuditLogLean } from '../infrastructure/schemas/audit-log.schema';

export interface AuditLogQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly actorId?: string;
  readonly action?: AuditAction;
  readonly entityType?: AuditEntityType;
  readonly entityId?: string;
  readonly from?: Date;
  readonly to?: Date;
}

export interface AuditLogPage {
  readonly items: readonly AuditLogLean[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/**
 * READING the audit trail. A separate class from `AuditService`, deliberately.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §8, which names this endpoint and
 * its exact query surface:
 *
 * ```
 * GET /api/v1/admin/audit-logs
 *     ?actorId=&action=&entityType=&entityId=&from=&to=&page=&limit=
 * ```
 *
 * ## Why not a method on `AuditService`
 *
 * Because that class's whole contract is "nothing outside this module writes
 * the trail, and nothing at all modifies it". It exposes `record` and
 * `recordChange`, both of which never throw because an audit write must not
 * fail a business operation. A read has the opposite requirements — it must
 * report a failure rather than swallow one — and putting the two on one class
 * would mean one object where half the methods are allowed to fail silently.
 *
 * The separation is also what keeps the module's export list honest: `AuditModule`
 * exports the WRITER to every module that audits, and the READER only to its own
 * controller. Nothing that writes the trail can list it.
 *
 * ## Every filter matches an index, and there is deliberately no text search
 *
 * `{createdAt:-1}` serves the unfiltered newest-first list; `{action, createdAt}`,
 * `{'actor.id', createdAt}` and `{'entity.type','entity.id', createdAt}` serve
 * the three filters §8 lists. That is not a coincidence — the frozen index set
 * was designed for exactly these questions.
 *
 * A free-text search over actions or actor names is NOT offered. No index
 * answers an unanchored pattern, so it would be a collection scan over two
 * years of records, on a screen an operator would type into. The Supabase
 * screen this replaces had one — `action.ilike.%…%` joined to `profiles` —
 * against a table holding **zero rows**, so nobody ever discovered what it
 * cost.
 */
@Injectable()
export class AuditReaderService {
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {}

  async list(query: AuditLogQuery): Promise<AuditLogPage> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filter: FilterQuery<AuditLog> = {};

    if (query.actorId !== undefined) filter['actor.id'] = new Types.ObjectId(query.actorId);
    if (query.action !== undefined) filter.action = query.action;
    if (query.entityType !== undefined) filter['entity.type'] = query.entityType;
    if (query.entityId !== undefined) filter['entity.id'] = new Types.ObjectId(query.entityId);

    if (query.from !== undefined || query.to !== undefined) {
      filter.createdAt = {
        ...(query.from === undefined ? {} : { $gte: query.from }),
        ...(query.to === undefined ? {} : { $lte: query.to }),
      };
    }

    const [items, total] = await Promise.all([
      this.model
        /*
         * `_id` in the sort as well as `createdAt`. Two records written in the
         * same millisecond — which is ordinary, since one operation can audit
         * twice — would otherwise paginate unstably, repeating one row on page
         * two and skipping another.
         */
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AuditLogLean[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total, page, limit };
  }

  /**
   * The distinct actions present in the trail, for a filter dropdown.
   *
   * The enum has thirty-odd members and most of them will never appear in a
   * small shop's log; offering all of them makes an operator pick between
   * options that match nothing. This asks the data instead.
   *
   * Bounded by construction — `distinct` over a field whose values are an enum
   * cannot return more than the enum has.
   */
  async actionsPresent(): Promise<string[]> {
    const actions = await this.model.distinct('action').exec();

    return (actions as string[]).sort((a, b) => a.localeCompare(b));
  }
}
