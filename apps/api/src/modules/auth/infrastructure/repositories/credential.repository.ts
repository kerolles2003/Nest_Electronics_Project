import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AppException } from '../../../../common/errors/app.exception';
import { Role, User, type UserLean } from '../../../users/infrastructure/schemas/user.schema';

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/**
 * The credential view of a user. Everything authentication needs, and nothing
 * that belongs to a profile response.
 */
export type UserCredentials = Pick<
  UserLean,
  '_id' | 'email' | 'passwordHash' | 'emailVerifiedAt' | 'tokenVersion' | 'role' | 'deletedAt'
>;

const CREDENTIAL_PROJECTION = {
  _id: 1,
  email: 1,
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
      // The index name is inspected SERVER-SIDE only; the client sees a stable
      // code and a safe message, never a constraint name.
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

  async recordLogin(userId: Types.ObjectId): Promise<void> {
    await this.model.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } }).exec();
  }
}
