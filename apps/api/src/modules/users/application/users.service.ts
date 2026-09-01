import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, type UserLean } from '../infrastructure/schemas/user.schema';

/**
 * The profile view. `passwordHash`, `tokenVersion` and `emailVerification` are
 * excluded AT THE DATABASE, not stripped afterwards — the fields never enter
 * the process, so no later code change can leak them.
 */
export type UserProfile = Pick<
  UserLean,
  '_id' | 'email' | 'fullName' | 'phone' | 'role' | 'emailVerifiedAt' | 'lastLoginAt' | 'createdAt'
>;

const PROFILE_PROJECTION = {
  _id: 1,
  email: 1,
  fullName: 1,
  phone: 1,
  role: 1,
  emailVerifiedAt: 1,
  lastLoginAt: 1,
  createdAt: 1,
} as const;

/**
 * Profile reads.
 *
 * Still ONE projected `findOne`, and still on the model directly. The
 * repository this class once said would "arrive with address CRUD" did arrive —
 * `UserRepository` — but it exists to hold the address-book WRITE PIPELINE and
 * the default invariant, which is something to isolate; wrapping this single
 * read in it as well would add a hop that isolates nothing
 * (CODEBASE-STRUCTURE.md §6.2). Both bind to the same model in the same module,
 * so there is no second source of truth.
 *
 * Profile UPDATE is no longer on the absent list: `PATCH /users/me` exists, and
 * `/account/profile` cannot migrate without it (PLAN §9).
 *
 * Deliberately still absent: the admin customer list and role management. Each
 * brings its own DTOs, invariants and authorization tests, and neither is
 * reachable from the current surface.
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  /** Null for an unknown or soft-deleted user — a disabled account has no profile. */
  async findById(userId: Types.ObjectId): Promise<UserProfile | null> {
    return this.model
      .findOne({ _id: userId, deletedAt: null })
      .select(PROFILE_PROJECTION)
      .lean<UserProfile>()
      .exec();
  }

  /**
   * Applies a partial profile edit and returns the updated profile.
   *
   * ## Why the `$set` is built from named fields
   *
   * `{ $set: patch }` would be shorter and would be a privilege-escalation bug:
   * whatever the DTO carried would go straight into the document. The global
   * `forbidNonWhitelisted` pipe already rejects an unknown field with
   * `400 UNKNOWN_FIELD`, and `strict: 'throw'` on the schema would refuse one
   * that got past it — but a `role` or `emailVerifiedAt` sent by a client is
   * neither unknown to the DTO's shape nor unknown to the schema. Naming the two
   * writable fields here is the layer that does not depend on the other two
   * being configured correctly.
   *
   * ## Absent versus null
   *
   * An omitted key is left alone; `phone: null` clears the number. Building the
   * update from `!== undefined` rather than truthiness is what keeps those
   * distinct — a truthiness check would silently ignore a deliberate `null` and
   * the customer's old number would stay on the account.
   *
   * Returns `null` for an unknown or soft-deleted user, matching `findById`, so
   * the caller answers 404 rather than reviving a disabled account.
   */
  async updateProfile(
    userId: Types.ObjectId,
    patch: { fullName?: string; phone?: string | null },
  ): Promise<UserProfile | null> {
    const update: { fullName?: string; phone?: string | null } = {};

    if (patch.fullName !== undefined) update.fullName = patch.fullName;
    if (patch.phone !== undefined) update.phone = patch.phone;

    /*
     * An empty patch is a legal request and must not become an empty `$set`,
     * which MongoDB rejects. Answering with the current profile is the honest
     * result of "change nothing".
     */
    if (Object.keys(update).length === 0) {
      return this.findById(userId);
    }

    return this.model
      .findOneAndUpdate({ _id: userId, deletedAt: null }, { $set: update }, { new: true })
      .select(PROFILE_PROJECTION)
      .lean<UserProfile>()
      .exec();
  }
}
