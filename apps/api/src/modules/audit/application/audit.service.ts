import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditAction, AuditEntityType } from '../domain/audit-action';
import { diffFields, type AuditChanges } from '../domain/audit-diff';
import { AuditLog } from '../infrastructure/schemas/audit-log.schema';

/**
 * Writing the security audit trail.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §5.
 *
 * ## The four rules, and how each is kept here
 *
 * 1. **Written by the system, never by the acting principal.** Nothing accepts
 *    an audit record from a client: there is no DTO, no endpoint and no
 *    parameter anywhere that reaches this method. Callers supply *what they
 *    did*; this service decides what is written. That closes the legacy defect
 *    where audit rows were written with the caller's own credentials, so an
 *    audited principal could in principle suppress their own trail.
 * 2. **Post-commit.** `record()` is called after the business transaction has
 *    committed, and it is not part of it. A completed order is more important
 *    than its audit line.
 * 3. **Failure is loud.** A failed write is logged at `error` with
 *    `event: 'AUDIT_WRITE_FAILED'` and never swallowed silently — the legacy
 *    failure mode was a silent swallow producing an empty table that LOOKED
 *    healthy, and was read sixty-one times in that state.
 * 4. **Immutable.** There is no update and no delete method on this service or
 *    its repository. The TTL is the only thing that removes a record.
 *
 * ## Where this deviates from the document, stated rather than chosen quietly
 *
 * §5's diagram names an `AuditInterceptor`. This is a service called from the
 * application layer instead, for a mechanical reason: an interceptor sees the
 * request and the response, and `changes.before/after` is a field-level diff
 * between two states of an entity that only the service performing the write
 * ever holds. An interceptor could record *that* something happened, never
 * *what changed*, and §4 requires the second.
 *
 * All four rules above are satisfied either way — the acting principal still
 * has no write path, the write is still post-commit, failures are still loud,
 * and the collection is still append-only. **The deviation is from the
 * illustration, not from the rules, and it is recorded for the owner.**
 */

export interface AuditActorInput {
  readonly id: Types.ObjectId;
  readonly role: string;
  readonly name: string;
  readonly email: string;
}

/** Forensic context, from the request. Never supplied by a caller's body. */
export interface AuditContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

export interface AuditRecordInput {
  readonly actor: AuditActorInput;
  readonly action: AuditAction;
  readonly entity: {
    readonly type: AuditEntityType;
    readonly id: Types.ObjectId;
    readonly label: string;
  };
  /** Computed with `diffFields`, or absent for actions with no before state. */
  readonly changes?: AuditChanges | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly context: AuditContext;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {}

  /**
   * Records one audited action.
   *
   * **Never throws.** Rule 2 is that an audit write must not roll back a
   * successful business operation, and the only way to guarantee that at the
   * call site is for this to be incapable of failing the caller. The failure is
   * not lost — it is logged at `error`, which is what rule 3 asks for.
   */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.model.create({
        actor: {
          id: input.actor.id,
          role: input.actor.role,
          name: input.actor.name,
          email: input.actor.email,
        },
        action: input.action,
        entity: input.entity,
        changes: input.changes ?? null,
        metadata: input.metadata ?? null,
        ip: input.context.ip,
        userAgent: input.context.userAgent,
        requestId: input.context.requestId,
      });
    } catch (error) {
      /*
       * LOUD. The entire reason this collection exists is that its predecessor
       * failed silently for the lifetime of the system.
       *
       * Every field an investigator would need to reconstruct the lost entry is
       * in this line, because the row itself is what could not be written.
       */
      this.logger.error(
        `AUDIT_WRITE_FAILED action=${input.action} entity=${input.entity.type}:${input.entity.id.toHexString()} ` +
          `actor=${input.actor.id.toHexString()} requestId=${input.context.requestId} — ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Records a change, computing the diff, and writes nothing when nothing
   * changed.
   *
   * An audit row saying "somebody saved this and altered nothing" is noise in a
   * log whose whole value is signal — and a two-year retention makes noise
   * expensive.
   */
  async recordChange(
    input: Omit<AuditRecordInput, 'changes'> & {
      readonly before: Record<string, unknown>;
      readonly after: Record<string, unknown>;
    },
  ): Promise<void> {
    const changes = diffFields(input.before, input.after);

    if (changes === null) return;

    await this.record({
      actor: input.actor,
      action: input.action,
      entity: input.entity,
      changes,
      metadata: input.metadata ?? null,
      context: input.context,
    });
  }
}
