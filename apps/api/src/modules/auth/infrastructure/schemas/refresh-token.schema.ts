import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A single issued refresh token.
 *
 * Authority: docs/architecture/MONGODB-DESIGN.md §11 (`refreshTokens`);
 *            AUTHORIZATION-MODEL.md §2.7 (rotation, revocation, theft response).
 *
 * MongoDB rather than Redis, deliberately: REDIS-DECISION.md §5 keeps refresh
 * tokens here because DURABILITY is required — losing the store would log every
 * user out and, worse, would destroy the revocation record that makes replay
 * detection possible.
 *
 * The raw token NEVER touches the database. Only a SHA-256 digest is stored:
 * a database reader cannot mint a session from it. SHA-256 rather than bcrypt
 * because the token is 32 bytes of CSPRNG output, not a low-entropy human
 * secret — there is nothing to brute-force — and because a deterministic digest
 * is what makes the unique index a usable lookup key.
 */
@Schema({ collection: 'refreshTokens', timestamps: true, strict: 'throw' })
export class RefreshToken {
  /** SHA-256 of the raw token, hex. Unique — the lookup key. */
  @Prop({ type: String, required: true })
  tokenHash!: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  /**
   * The rotation chain this token belongs to. A login starts a family; every
   * refresh extends it.
   *
   * This is what makes the frozen theft response implementable: presenting an
   * already-revoked token means the token was captured, so the WHOLE FAMILY is
   * revoked rather than just the presented one. Revoking only the replayed
   * token would leave the thief's freshly rotated token valid.
   */
  @Prop({ type: Types.ObjectId, required: true })
  familyId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  /** Null while live. Set on rotation, logout, or family revocation. */
  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  /** Why it was revoked — diagnostic only, never returned to a client. */
  @Prop({ type: String, default: null })
  revokedReason!: string | null;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export type RefreshTokenLean = RefreshToken & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

/** Rotation and validation both look a token up by digest. Unique: a digest is one token. */
RefreshTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'refresh_token_hash_unique' });

/** `logout-all` revokes every live token for a user. */
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 }, { name: 'refresh_token_user' });

/** Theft response: revoke an entire rotation chain in one update. */
RefreshTokenSchema.index({ familyId: 1 }, { name: 'refresh_token_family' });

/**
 * TTL. MongoDB removes a document once `expiresAt` passes, so the collection
 * cannot grow without bound and dead tokens cannot accumulate.
 *
 * Note the interaction with replay detection, which is deliberate: a REVOKED
 * record survives until the moment its token would have expired anyway, which
 * is exactly as long as replaying it could have worked.
 */
RefreshTokenSchema.index({ expiresAt: 1 }, { name: 'refresh_token_ttl', expireAfterSeconds: 0 });
