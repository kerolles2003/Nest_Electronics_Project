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
 * Deliberately absent: profile update, admin customer list, role management.
 * None is reachable from the current surface, and each brings its own DTOs,
 * invariants and authorization tests. Address CRUD is no longer on that list —
 * it lives in `AddressesService` beside this class.
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
}
