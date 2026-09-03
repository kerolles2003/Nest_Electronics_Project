import type { Types } from 'mongoose';
import type { AuditActorInput } from '../application/audit.service';

/**
 * The four fields an audit record snapshots about who acted.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §4 — the actor is SNAPSHOTTED,
 * not referenced. The reason is in §2: the question an investigation starts
 * from is "what has this person done", and a joined actor stops answering it
 * the moment the account is deleted — which is exactly when somebody is asking.
 *
 * ## Why this is a pure function and not a service
 *
 * Because every audited write already holds the profile: it had to load one to
 * check the role. A `AuditActorService` would need `UsersService`, which would
 * make `AuditModule` depend on `UsersModule` — and Part 6 audits a role change,
 * so `UsersModule` will depend on `AuditModule`. That is a cycle, bought for
 * three lines of mapping. This is the three lines.
 */
export interface AuditableProfile {
  readonly _id: Types.ObjectId;
  readonly role: string;
  readonly fullName: string;
  readonly email: string;
}

export function toAuditActor(profile: AuditableProfile): AuditActorInput {
  return {
    id: profile._id,
    role: profile.role,
    name: profile.fullName,
    email: profile.email,
  };
}
