import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AppException } from '../../../../common/errors/app.exception';
import { Role, User, type UserLean } from '../../../users/infrastructure/schemas/user.schema';

/**
 * MongoDB's duplicate-key error code.
 *
 * **Every `catch` on this code below is a CONCURRENCY CONTROL, not error
 * handling.** The unique index is what makes the operation correct under
 * concurrency; the catch is only how the refusal is translated. Drop the
 * index and the error never arrives, the catch never runs, and the race
 * silently succeeds — no exception, no log line, nothing to notice.
 *
 * `GET /health/ready` refuses traffic when a declared index is missing, and
 * `test/infrastructure/index-health.spec.ts` lists every invariant that
 * depends on one. Do not remove an index named there.
 */
const DUPLICATE_KEY = 11000;

/**
 * The credential view of a user. Everything authentication needs, and nothing
 * that belongs to a profile response.
 */
export type UserCredentials = Pick<
  UserLean,
  | '_id'
  | 'email'
  | 'fullName'
  | 'passwordHash'
  | 'emailVerifiedAt'
  | 'tokenVersion'
  | 'role'
  | 'deletedAt'
>;

/**
 * `fullName` is here for ONE reason: addressing a verification email to a
 * person rather than to "there". `POST /auth/resend-verification` reaches this
 * projection and nothing else, so without it the resent mail would be less
 * personal than the one sent at registration.
 *
 * It is not a widening of the credential boundary — a name is the user's own,
 * carries no authorisation and appears in every profile response already. The
 * fields that must never leave this module remain `passwordHash`,
 * `tokenVersion` and `emailVerification`, and none of them is exposed by
 * anything that reads this type.
 */
const CREDENTIAL_PROJECTION = {
  _id: 1,
  email: 1,
  fullName: 1,
  passwordHash: 1,
  emailVerifiedAt: 1,
  tokenVersion: 1,
  role: 1,
  deletedAt: 1,
} as const;

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly verification: { readonly tokenHash: string; readonly expiresAt: Date } | null;
}

/**
 * A STAFF account, created by an operator rather than by registration.
 *
 * Separate from `CreateUserInput` because the two differ in exactly the way
 * that matters: this one names a role, and `create` deliberately cannot.
 */
export interface CreateStaffInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly phone: string | null;
  /** ADMIN or SUPER_ADMIN. A customer is created by registration, not by this. */
  readonly role: Role.ADMIN | Role.SUPER_ADMIN;
}

/**
 * The ONLY code in the system that reads or writes a password hash.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §1 — AuthModule owns "the
 * credential fields of `users` (`passwordHash`, `emailVerifiedAt`,
 * `tokenVersion`) via a dedicated repository"; AUTHORIZATION-MODEL.md §10 —
 * "`passwordHash` never leaves AuthModule; no other module imports the
 * credential repository."
 *
 * That rule is enforced structurally rather than by review: this class is
 * provided by `AuthModule` and is NOT exported from it, so no other module can
 * inject it even by accident.
 */
@Injectable()
export class CredentialRepository {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  /**
   * Creates the account. `role` is set HERE, by the server — it is absent from
   * `RegisterDto`, so there is no field for a client to inject into.
   *
   * Uniqueness is enforced by the DATABASE, not by a read-then-write check in
   * the service: a check-then-insert has a race window in which two concurrent
   * registrations both see "available". The duplicate-key error is translated
   * here so no driver text can reach a client.
   */
  async create(input: CreateUserInput, session?: ClientSession): Promise<UserLean> {
    try {
      const [created] = await this.model.create(
        [
          {
            email: input.email,
            passwordHash: input.passwordHash,
            fullName: input.fullName,
            phone: input.phone,
            role: Role.CUSTOMER,
            emailVerifiedAt: null,
            emailVerification: input.verification,
            tokenVersion: 1,
          },
        ],
        session === undefined ? {} : { session },
      );

      if (created === undefined) {
        throw new Error('user insert returned no document');
      }

      return created.toObject<UserLean>();
    } catch (error) {
      /*
       * `users.user_email_unique` IS the check for "is this address taken".
       *
       * There is deliberately no `findOne` before the insert: two registrations
       * racing would both see "available" and both proceed. The index is the
       * only thing that serialises them, so this catch is the concurrency
       * control and not a fallback for one.
       *
       * Without the index, both inserts succeed and the account has two rows.
       * Login then resolves to whichever the query returns first, and a password
       * reset fixes one of them.
       *
       * The index name is inspected SERVER-SIDE only; the client sees a stable
       * code and a safe message, never a constraint name.
       */
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: number }).code === DUPLICATE_KEY
      ) {
        throw AppException.duplicateEmail();
      }

      throw error;
    }
  }

  /**
   * Creates a STAFF account, with the role the caller names.
   *
   * ## Why this is a second method and not a parameter on `create`
   *
   * `create` hard-codes `Role.CUSTOMER` and that is a security property, not a
   * default: `RegisterDto` has no role field, so there is nothing for a client
   * to inject into, and no argument for a future caller to pass by mistake.
   * Adding an optional `role` to it would put a privilege escalation one typo
   * away from the public registration path.
   *
   * This method has no HTTP route. Nothing in `presentation/` reaches it —
   * `StaffProvisioningService` is its only caller, and that service is only
   * ever driven from a command line by a person who already holds the database.
   * Staff accounts are provisioned, never self-served (AUTHORIZATION-MODEL.md
   * §3): there is no "sign up as an admin".
   *
   * ## Verified at creation, with no challenge
   *
   * `emailVerifiedAt` is set and `emailVerification` is null. Verification
   * exists to prove that whoever registered controls the address; an operator
   * standing at a terminal with database access has already established far
   * more than that, and leaving the account unverified would only mean a
   * freshly provisioned admin cannot sign in until a mail they never receive
   * is clicked.
   *
   * Uniqueness is the DATABASE's, exactly as it is for a customer — the same
   * unique index, the same translated refusal, and the same absence of a
   * read-then-write race.
   */
  async createStaff(input: CreateStaffInput): Promise<UserLean> {
    try {
      const [created] = await this.model.create([
        {
          email: input.email,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          phone: input.phone,
          role: input.role,
          emailVerifiedAt: new Date(),
          emailVerification: null,
          tokenVersion: 1,
        },
      ]);

      if (created === undefined) {
        throw new Error('staff insert returned no document');
      }

      return created.toObject<UserLean>();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: number }).code === DUPLICATE_KEY
      ) {
        throw AppException.duplicateEmail();
      }

      throw error;
    }
  }

  /** How many accounts hold this role. Used to refuse a silent second super-admin. */
  async countByRole(role: Role): Promise<number> {
    return this.model.countDocuments({ role, deletedAt: null }).exec();
  }

  /** Login lookup. Returns null for an unknown address — the caller must not branch visibly on that. */
  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    return this.model
      .findOne({ email })
      .select(CREDENTIAL_PROJECTION)
      .lean<UserCredentials>()
      .exec();
  }

  /** Used during refresh to confirm the account is still allowed to hold a session. */
  async findCredentialsById(
    userId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<UserCredentials | null> {
    return this.model
      .findById(userId)
      .select(CREDENTIAL_PROJECTION)
      .session(session ?? null)
      .lean<UserCredentials>()
      .exec();
  }

  /**
   * Resolves a verification challenge by its DIGEST.
   *
   * The raw token is never stored, so this is the only way to find the account
   * a token belongs to. The expiry is compared in the query rather than in code
   * so an expired challenge simply does not match.
   */
  async findByVerificationTokenHash(tokenHash: string): Promise<UserCredentials | null> {
    return this.model
      .findOne({
        'emailVerification.tokenHash': tokenHash,
        'emailVerification.expiresAt': { $gt: new Date() },
      })
      .select(CREDENTIAL_PROJECTION)
      .lean<UserCredentials>()
      .exec();
  }

  /** Completes verification and discards the challenge so the token is single-use. */
  async markEmailVerified(userId: Types.ObjectId): Promise<void> {
    await this.model
      .updateOne(
        { _id: userId },
        { $set: { emailVerifiedAt: new Date(), emailVerification: null } },
      )
      .exec();
  }

  /** Replaces any outstanding challenge, so a resend invalidates the previous token. */
  async setVerificationChallenge(
    userId: Types.ObjectId,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.model
      .updateOne({ _id: userId }, { $set: { emailVerification: { tokenHash, expiresAt } } })
      .exec();
  }

  /**
   * Replaces any outstanding reset challenge, so requesting a second link
   * invalidates the first.
   *
   * That is not only tidiness. Without it, every "I didn't get the email" click
   * would leave another live key to the account sitting in a mailbox, and the
   * oldest of them would still work an hour later.
   */
  async setPasswordResetChallenge(
    userId: Types.ObjectId,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.model
      .updateOne({ _id: userId }, { $set: { passwordReset: { tokenHash, expiresAt } } })
      .exec();
  }

  /**
   * The account holding a live reset challenge, or `null`.
   *
   * Expiry is compared IN THE QUERY rather than in code, so an expired
   * challenge simply does not match and the caller cannot forget to check it —
   * the same shape as `findByVerificationTokenHash`, for the same reason.
   *
   * It looks at `passwordReset` and never at `emailVerification`. A token minted
   * to confirm an address must not be presentable here: one activates an
   * account, the other replaces its password, and both are a hash and a date.
   */
  async findByPasswordResetTokenHash(tokenHash: string): Promise<UserCredentials | null> {
    return this.model
      .findOne({
        'passwordReset.tokenHash': tokenHash,
        'passwordReset.expiresAt': { $gt: new Date() },
      })
      .select(CREDENTIAL_PROJECTION)
      .lean<UserCredentials>()
      .exec();
  }

  /**
   * Completes a reset: new hash, challenge discarded, `tokenVersion` bumped.
   *
   * ONE update, and the three parts must not be separable.
   *
   *   the new hash        the reset itself
   *   `passwordReset: null`  makes the token single-use
   *   `$inc tokenVersion`    invalidates every outstanding ACCESS token
   *
   * Splitting them would leave states worth naming: a password changed while
   * the old token still works, or a password changed while an attacker's
   * fifteen-minute access token keeps working. `AUTHORIZATION-MODEL.md` §2.8
   * requires all three.
   *
   * Refresh tokens are revoked by the caller in the SAME transaction, because
   * they outlive access tokens by thirty days and this update cannot reach them.
   *
   * The filter re-checks the challenge, so two confirmations racing on one
   * token cannot both succeed: the loser matches nothing and gets
   * `modifiedCount: 0`, which the caller reads as "already used".
   */
  async completePasswordReset(
    userId: Types.ObjectId,
    tokenHash: string,
    passwordHash: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: userId, 'passwordReset.tokenHash': tokenHash },
        {
          $set: { passwordHash, passwordReset: null },
          $inc: { tokenVersion: 1 },
        },
        session === undefined ? {} : { session },
      )
      .exec();

    return result.modifiedCount === 1;
  }

  async recordLogin(userId: Types.ObjectId): Promise<void> {
    await this.model.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } }).exec();
  }
}
