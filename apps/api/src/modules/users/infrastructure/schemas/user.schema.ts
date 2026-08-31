import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * The three roles. No permission system.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §3 (ADR-AUTH-004).
 *
 * A permission/ability engine was evaluated and rejected: there are three actor
 * classes and no evidence of a fourth. Legacy declared both admin roles and
 * enforced the distinction in none of the three places it appeared; here
 * SUPER_ADMIN is genuinely separate — role management, user deletion and hard
 * deletes are its alone.
 *
 * Revisit condition: if staff roles genuinely diverge (a content editor who may
 * not touch inventory), `@Roles()` becomes `@RequirePermission()` and roles
 * become permission bundles. That migration is additive.
 */
export enum Role {
  CUSTOMER = 'CUSTOMER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

/**
 * A pending email-verification challenge, embedded rather than given its own
 * collection.
 *
 * MONGODB-DESIGN.md §11 enumerates every supporting collection and does not
 * include one for verification tokens, so inventing one would contradict the
 * frozen design. It is single-document, read only during verification, and
 * lifecycle-bound to the user — the embed heuristic in §1 says embed.
 *
 * The token is stored HASHED. A database reader must not be able to verify
 * somebody else's email address.
 */
@Schema({ _id: false, strict: 'throw' })
export class EmailVerification {
  @Prop({ type: String, required: true })
  tokenHash!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}
const EmailVerificationSchema = SchemaFactory.createForClass(EmailVerification);

/**
 * ONE saved delivery address in the customer's address book.
 *
 * Authority: docs/architecture/MONGODB-DESIGN.md §3 and §12.3 — addresses are
 * EMBEDDED in the user document, which is one of the four explicit relationship
 * decisions the frozen design ratified. The reasoning is preserved verbatim
 * here because this phase depends on it: bounded (~1-10 per user), only ever
 * read for ONE user, never queried globally, and — the load-bearing half — the
 * single-document embed makes "exactly one default" enforceable in ONE ATOMIC
 * UPDATE. The legacy defect was that setting a new default never unset the
 * previous one, so a user could hold several.
 *
 * The FIELD SET is exactly the live business model. `docs/db/schema.sql:11`
 * defines `addresses` as `{id, user_id, label, full_name, phone, street, city,
 * governorate, postal_code, is_default, created_at}` and MONGODB-DESIGN.md §3
 * carries the same shape forward. `country` is absent because the shop ships
 * within Egypt only; `area`, `buildingNumber`, `apartment` and `landmark` are
 * absent because the business has never captured them — `street` is documented
 * as "street, building and apartment, as one line". Adding them would also add
 * four permanently-null fields to the IMMUTABLE order snapshot, which is where
 * a speculative field becomes impossible to remove.
 *
 * `_id` is present (no `_id: false`) because an address is individually
 * addressable: `/users/me/addresses/:addressId`.
 *
 * `createdAt` and `updatedAt` are DECLARED PROPS rather than `timestamps: true`.
 * Every write here is an aggregation-pipeline update, and Mongoose does not
 * inject subdocument timestamps into a pipeline — a declared prop the
 * repository sets explicitly is honest about who writes it. `createdAt` is also
 * load-bearing rather than decorative: it is the primary key of the documented
 * deterministic rule for promoting a replacement default.
 */
@Schema({ strict: 'throw' })
export class Address {
  /** The customer's own name for it — "Home", "Work". Never shown to a courier. */
  @Prop({ type: String, required: true, trim: true })
  label!: string;

  /** The RECIPIENT, who may not be the account holder. */
  @Prop({ type: String, required: true, trim: true })
  fullName!: string;

  /** The number the courier calls. Egyptian format, validated at the DTO. */
  @Prop({ type: String, required: true, trim: true })
  phone!: string;

  /** Street, building and apartment as one line — the live business shape. */
  @Prop({ type: String, required: true, trim: true })
  street!: string;

  @Prop({ type: String, required: true, trim: true })
  city!: string;

  /**
   * Free text, NOT an enum. The governorate list belongs to the shipping rate
   * table, which OPEN-001 records as unsupplied business input; constraining it
   * to a guessed list would reject valid addresses and widening it later is a
   * breaking change within v1.
   */
  @Prop({ type: String, required: true, trim: true })
  governorate!: string;

  /** Rarely used in Egypt. Null, never an empty string. */
  @Prop({ type: String, default: null, trim: true })
  postalCode!: string | null;

  /**
   * THE invariant: at most one `true` per user, ever.
   *
   * Not enforced by an index — it cannot be, inside an array — but by every
   * write being a single atomic pipeline that RECOMPUTES the flag across the
   * whole array rather than setting it on one element. See
   * `UserRepository.defaultRepairStage`.
   */
  @Prop({ type: Boolean, required: true, default: false })
  isDefault!: boolean;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  updatedAt!: Date;
}
export const AddressSchema = SchemaFactory.createForClass(Address);

/** An address as read back, with its generated id. */
export type AddressLean = Address & { _id: Types.ObjectId };

/**
 * The address-book cap, applied server-side.
 *
 * Authority: MONGODB-DESIGN.md §3 — "`addresses` is bounded by UX (a 'max 10
 * addresses' rule is applied)". It is the growth argument that justifies the
 * embed, so it is enforced in the CREATE FILTER rather than trusted: an
 * unbounded array would eventually make the user document a scaling problem,
 * and the frozen design's "growth risk: none" claim depends on this number.
 */
export const MAX_ADDRESSES_PER_USER = 10;

/**
 * Identity, credentials and profile in ONE document.
 *
 * Authority: docs/architecture/MONGODB-DESIGN.md §3.
 *
 * Legacy split this across `auth.users` and `profiles` — a 1:1 relationship that
 * required a database trigger just to stay in sync, and whose trigger set
 * `full_name` to the user's email address. Merging deletes the trigger, the
 * orphan risk and a join.
 *
 * `passwordHash`, `emailVerifiedAt`, `tokenVersion` and `emailVerification` are
 * CREDENTIAL fields. They are owned by AuthModule through a dedicated
 * repository, and no other module imports it (AUTHORIZATION-MODEL.md §10).
 *
 * `addresses[]` is declared as of this phase — the address book, its CRUD and
 * the default-address invariant now exist, so the field has readers and
 * writers.
 *
 * Frozen fields still deliberately NOT declared, because nothing reads or
 * writes them and every one of them is additive in a document store:
 *   stats{}      — written by OrdersModule on placement
 *   avatar       — MediaModule, itself deferred
 */
@Schema({ collection: 'users', timestamps: true, strict: 'throw' })
export class User {
  /** Unique, lowercase. The natural key, and the login identifier. */
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  email!: string;

  /**
   * bcrypt hash. NEVER leaves AuthModule: it is absent from every response DTO
   * and excluded by projection in every read outside the credential repository.
   */
  @Prop({ type: String, required: true })
  passwordHash!: string;

  @Prop({ type: Date, default: null })
  emailVerifiedAt!: Date | null;

  @Prop({ type: EmailVerificationSchema, default: null })
  emailVerification!: EmailVerification | null;

  /**
   * Incremented to invalidate every outstanding access token at once.
   *
   * Access tokens are not revocable by design (15 minutes, no per-request
   * lookup — legacy looked up `profiles.role` on EVERY request, making
   * `profiles_pkey` the hottest index in the database at 2,719 scans). This
   * counter is the escape hatch for the cases where waiting 15 minutes is not
   * acceptable: password change, role change, forced logout.
   */
  @Prop({ type: Number, required: true, default: 1, min: 1 })
  tokenVersion!: number;

  /** Required. Legacy fell back to the email address, which is a data-quality bug. */
  @Prop({ type: String, required: true, trim: true })
  fullName!: string;

  @Prop({ type: String, default: null, trim: true })
  phone!: string | null;

  /**
   * The saved address book. Empty for an account that has never checked out.
   *
   * Every element is written by an ATOMIC PIPELINE UPDATE on this document, so
   * "at most one `isDefault: true`" holds under any amount of concurrency
   * without a transaction, a lock or a unique index — MongoDB serialises
   * updates to a single document, and each update recomputes the flag across
   * the whole array rather than setting it on one element.
   *
   * Capped at `MAX_ADDRESSES_PER_USER` in the create filter.
   */
  @Prop({ type: [AddressSchema], default: [] })
  addresses!: Address[];

  /** Set by the SERVER at registration. Absent from every self-service DTO. */
  @Prop({ type: String, required: true, enum: Object.values(Role), default: Role.CUSTOMER })
  role!: Role;

  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null;

  /**
   * Soft delete, and the account-disabled state. A soft-deleted user can never
   * authenticate, and the check happens AFTER password verification so the
   * response cannot be used to enumerate accounts.
   */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;
}

export type UserDocument = HydratedDocument<User>;
export type UserLean = User & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const UserSchema = SchemaFactory.createForClass(User);

/**
 * The only index declared today, and the only one with a reader: login by email
 * and duplicate-registration prevention. Uniqueness is enforced by the DATABASE,
 * not by a read-then-write race in the service.
 *
 * MONGODB-DESIGN.md §3 also lists `{ role, createdAt }`, `{ phone }` sparse and
 * a text index on name/email. All three serve the admin customer list and admin
 * search, which do not exist yet. Creating them now would pay the write cost of
 * indexes nothing can read — precisely the legacy defect where a GIN index
 * recorded 0 scans against 1,282 sequential scans. They arrive with their
 * queries.
 */
UserSchema.index({ email: 1 }, { unique: true, name: 'user_email_unique' });
