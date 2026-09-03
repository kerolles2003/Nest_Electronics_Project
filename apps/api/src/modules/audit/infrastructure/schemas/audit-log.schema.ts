import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AuditAction, AuditEntityType } from '../../domain/audit-action';

/**
 * The security audit record.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §4 (document shape), §5 (how it
 * is written), §7 (retention), §8 (access).
 *
 * ## The failure this is engineered against
 *
 * Legacy's `admin_audit_logs` held **zero rows** — despite ten orders, eight
 * status transitions, eighty-five products and an active super-admin. The cause
 * was a write of a `user_agent` column that did not exist; PostgREST RETURNED
 * the error in the response object rather than throwing, so the surrounding
 * `try/catch` never fired. The admin screen rendered an empty table that read
 * as "no admin activity yet" rather than "this subsystem is broken", and it was
 * read sixty-one times in that state.
 *
 * `strict: 'throw'` is the direct answer: an unknown field raises here rather
 * than being silently dropped. `userAgent` — the exact field whose absence
 * broke legacy — is declared below.
 */

/**
 * A SNAPSHOT of who acted, not a reference to them.
 *
 * §4: "the record must remain readable after the actor is deleted or renamed".
 * A join to `users` would make the audit trail of a deleted administrator
 * unreadable, which is precisely when it is most likely to be wanted.
 */
@Schema({ _id: false, versionKey: false })
export class AuditActor {
  @Prop({ type: Types.ObjectId, required: true })
  id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  role!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  email!: string;
}

const AuditActorSchema = SchemaFactory.createForClass(AuditActor);

/** What the action was about. `label` keeps the log readable without joins. */
@Schema({ _id: false, versionKey: false })
export class AuditEntity {
  @Prop({ type: String, required: true, enum: Object.values(AuditEntityType) })
  type!: AuditEntityType;

  @Prop({ type: Types.ObjectId, required: true })
  id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  label!: string;
}

const AuditEntitySchema = SchemaFactory.createForClass(AuditEntity);

/**
 * Only the fields that changed, never whole documents, with values that must
 * never be stored replaced by a marker. See `domain/audit-diff.ts`.
 *
 * `strict: false` on this ONE sub-document, deliberately: its keys are dotted
 * field paths from arbitrary entities and cannot be declared in advance. Every
 * other part of the record is strict, and what goes in here has already passed
 * through the redaction in `diffFields` — this is not a hole through which
 * unvalidated input reaches the database, because no API accepts an audit
 * record at all (§5, rule 1).
 */
@Schema({ _id: false, versionKey: false, strict: false })
export class AuditChangeSet {
  @Prop({ type: Object, required: true })
  before!: Record<string, unknown>;

  @Prop({ type: Object, required: true })
  after!: Record<string, unknown>;
}

const AuditChangeSetSchema = SchemaFactory.createForClass(AuditChangeSet);

@Schema({
  collection: 'auditLogs',
  versionKey: false,
  /*
   * The whole point. An unknown field RAISES rather than being dropped — which
   * is the exact legacy defect, one layer down, where a column that did not
   * exist was accepted and discarded.
   */
  strict: 'throw',
  timestamps: { createdAt: 'createdAt', updatedAt: false },
})
export class AuditLog {
  @Prop({ type: AuditActorSchema, required: true })
  actor!: AuditActor;

  @Prop({ type: String, required: true, enum: Object.values(AuditAction) })
  action!: AuditAction;

  @Prop({ type: AuditEntitySchema, required: true })
  entity!: AuditEntity;

  @Prop({ type: AuditChangeSetSchema, default: null })
  changes!: AuditChangeSet | null;

  /** Free-form context — a reason, a note. Never a credential. */
  @Prop({ type: Object, default: null })
  metadata!: Record<string, unknown> | null;

  @Prop({ type: String, default: null })
  ip!: string | null;

  /** The exact field whose absence silently broke the legacy audit trail. */
  @Prop({ type: String, default: null })
  userAgent!: string | null;

  /** Correlates the record with the request log line and the error response. */
  @Prop({ type: String, required: true })
  requestId!: string;

  createdAt!: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export type AuditLogLean = AuditLog & { _id: Types.ObjectId };

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

/**
 * `{ createdAt }` with a two-year TTL — §7.
 *
 * The TTL is the ONLY thing that removes an audit record. §5 rule 4: the
 * collection is append-only, and there is no update or delete API. An audit
 * trail somebody can edit is not an audit trail.
 */
const TWO_YEARS_IN_SECONDS = 2 * 365 * 24 * 60 * 60;

AuditLogSchema.index(
  { createdAt: -1 },
  { name: 'audit_created_ttl', expireAfterSeconds: TWO_YEARS_IN_SECONDS },
);

/**
 * `{ entity.type, entity.id, createdAt }` — "what happened to this thing".
 *
 * The question the admin screen asks when an operator opens one order or one
 * product and wants its history. Without it that is a collection scan over two
 * years of records.
 */
AuditLogSchema.index(
  { 'entity.type': 1, 'entity.id': 1, createdAt: -1 },
  { name: 'audit_entity_history' },
);

/**
 * `{ actor.id, createdAt }` — "what has this person done".
 *
 * The question an investigation actually starts from, and the reason the actor
 * is snapshotted rather than joined: this index still answers it after the
 * account is gone.
 */
AuditLogSchema.index({ 'actor.id': 1, createdAt: -1 }, { name: 'audit_actor_history' });

/** `{ action, createdAt }` — "every role change", "every price change". */
AuditLogSchema.index({ action: 1, createdAt: -1 }, { name: 'audit_action_history' });
