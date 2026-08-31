import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { RefreshToken, type RefreshTokenLean } from '../schemas/refresh-token.schema';

/** Why a token was revoked. Diagnostic only — never returned to a client. */
export type RevocationReason = 'ROTATED' | 'LOGOUT' | 'LOGOUT_ALL' | 'REPLAY_DETECTED';

export interface IssueRefreshTokenInput {
  readonly tokenHash: string;
  readonly userId: Types.ObjectId;
  readonly familyId: Types.ObjectId;
  readonly expiresAt: Date;
}

/**
 * Persistence for the refresh-token store.
 *
 * A concrete class with no interface: PORTS-AND-CONTRACTS.md §4 lists the six
 * contracts that exist and this is not one of them. There is one implementation
 * and there will only ever be one — an interface here would be pure indirection.
 */
@Injectable()
export class RefreshTokenRepository {
  constructor(
    @InjectModel(RefreshToken.name) private readonly model: Model<RefreshToken>,
  ) {}

  async issue(input: IssueRefreshTokenInput, session?: ClientSession): Promise<void> {
    await this.model.create(
      [{ ...input, revokedAt: null, revokedReason: null }],
      session === undefined ? {} : { session },
    );
  }

  async findByHash(
    tokenHash: string,
    session?: ClientSession,
  ): Promise<RefreshTokenLean | null> {
    return this.model
      .findOne({ tokenHash })
      .session(session ?? null)
      .lean<RefreshTokenLean>()
      .exec();
  }

  /**
   * Revokes one token, but ONLY if it is still live.
   *
   * The `revokedAt: null` predicate is the concurrency guard, and it is the
   * reason rotation is safe: if two requests present the same refresh token at
   * once, exactly one update matches. The loser sees `modifiedCount === 0` and
   * is handled as a failed rotation rather than being issued a second live
   * token. Returns whether this caller won.
   */
  async revokeIfLive(
    id: Types.ObjectId,
    reason: RevocationReason,
    session?: ClientSession,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: id, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } },
        session === undefined ? {} : { session },
      )
      .exec();

    return result.modifiedCount === 1;
  }

  /**
   * Revokes an entire rotation chain — the response to a replayed token.
   *
   * Revoking only the replayed token would be useless: whoever stole it has
   * already rotated, and their fresh token would stay valid. Killing the family
   * ends both the thief's session and the victim's, which is the correct
   * outcome when one of them is known to be compromised.
   */
  async revokeFamily(
    familyId: Types.ObjectId,
    reason: RevocationReason,
    session?: ClientSession,
  ): Promise<number> {
    const result = await this.model
      .updateMany(
        { familyId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } },
        session === undefined ? {} : { session },
      )
      .exec();

    return result.modifiedCount;
  }

  /** `logout-all`: every live session for one user. */
  async revokeAllForUser(userId: Types.ObjectId, reason: RevocationReason): Promise<number> {
    const result = await this.model
      .updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } },
      )
      .exec();

    return result.modifiedCount;
  }

  /** Live session count for a user. Used by tests to assert revocation actually happened. */
  async countLiveForUser(userId: Types.ObjectId): Promise<number> {
    return this.model
      .countDocuments({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
      .exec();
  }
}
