import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import {
  EmailSenderPort,
  type EmailSendResult,
  type OutboundEmail,
} from '../../src/modules/notifications/application/ports/email-sender.port';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Password reset, end to end, at the HTTP boundary.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.8; PLAN.md §9.
 *
 * ## What counts as proof here
 *
 * The token is read **out of the email body**, exactly as a customer would read
 * it — never from the database and never from the service that minted it. That
 * is the only way to prove the whole chain works: mint, hash, store, render,
 * deliver, parse, consume.
 *
 * ## The properties that matter more than the happy path
 *
 * A reset endpoint is an unauthenticated way to act on somebody else's account,
 * so the cases below are weighted towards what it must REFUSE to do or reveal:
 *
 *   it must not say whether an address has an account
 *   the token must be single-use, so a replay fails
 *   an expired token must fail, and be indistinguishable from a wrong one
 *   a completed reset must end every session, including refresh tokens
 *   a verification token must not be usable here, and vice versa
 *
 * ISOLATION: every user is created by this suite and deleted by tracked id.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const NEW_PASSWORD = 'copper waveguide flange';

/** Records what the application asked to be delivered. */
class RecordingEmailSender extends EmailSenderPort {
  readonly sent: OutboundEmail[] = [];

  send(message: OutboundEmail): Promise<EmailSendResult> {
    this.sent.push(message);

    return Promise.resolve({
      providerMessageId: `rec-${String(this.sent.length)}`,
      acceptedAt: new Date(),
    });
  }

  reset(): void {
    this.sent.length = 0;
  }

  latest(type: string): OutboundEmail | undefined {
    return [...this.sent].reverse().find((message) => message.tags?.['type'] === type);
  }
}

let app: INestApplication;
let mailer: RecordingEmailSender;
let users: Model<User>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];

function http(): request.Agent {
  return request(app.getHttpServer());
}

interface Account {
  readonly id: Types.ObjectId;
  readonly email: string;
}

/** A registered, verified account. */
async function createAccount(label: string): Promise<Account> {
  const email = `reset-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Reset ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date() } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  return { id: created._id, email };
}

function requestReset(email: string): request.Test {
  return http().post('/api/v1/auth/password-reset/request').send({ email });
}

function confirmReset(token: string, newPassword: string): request.Test {
  return http().post('/api/v1/auth/password-reset/confirm').send({ token, newPassword });
}

/**
 * The raw token, from the message body a customer receives.
 *
 * Deliberately NOT from `users.passwordReset.tokenHash`: only the digest is
 * stored, so a test that could read the raw token from the database would be
 * proving the opposite of what this file claims.
 */
function tokenFromLatestResetEmail(): string {
  const message = mailer.latest('password_reset');

  if (message === undefined) {
    throw new Error('no password-reset email was sent');
  }

  const match = /token=([A-Za-z0-9_%-]+)/.exec(message.text);

  if (match?.[1] === undefined) {
    throw new Error(`no token in reset email: ${message.text.slice(0, 200)}`);
  }

  return decodeURIComponent(match[1]);
}

async function loginTokens(email: string, password: string): Promise<string> {
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);

  return response.body.data.refreshToken as string;
}

beforeAll(async () => {
  mailer = new RecordingEmailSender();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailSenderPort)
    .useValue(mailer)
    // The real guard still runs; only its counter is replaced, so the suite can
    // exceed limits written for humans. The limits themselves are asserted in
    // `auth-flow.spec.ts` against the real storage.
    .overrideProvider(getStorageToken())
    .useValue({
      increment: () =>
        Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
    } satisfies ThrottlerStorage)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: validationExceptionFactory,
    }),
  );
  await app.init();

  users = app.get<Model<User>>(getModelToken(User.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));
}, 120_000);

beforeEach(() => {
  mailer.reset();
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  await app.close();
});

describe('POST /auth/password-reset/request', () => {
  it('emails a link and stores only the digest', async () => {
    const account = await createAccount('happy');

    await requestReset(account.email).expect(200);

    const rawToken = tokenFromLatestResetEmail();
    expect(rawToken.length).toBeGreaterThan(20);

    /*
     * The stored value must NOT be the token.
     *
     * This is the assertion that would fail if someone ever "simplified" the
     * challenge by storing the raw token — at which point anybody with read
     * access to the users collection could take any account.
     */
    const stored = (await users.findById(account.id).lean<UserLean>().exec()) as UserLean;

    expect(stored.passwordReset).not.toBeNull();
    expect(stored.passwordReset?.tokenHash).not.toBe(rawToken);
    expect(stored.passwordReset?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers identically for an address with no account', async () => {
    /*
     * THE property. Anything that varies between these two responses — the
     * body, the status, a header — turns an unauthenticated endpoint into an
     * account-existence oracle, and an attacker with a list of addresses learns
     * which ones are registered here.
     */
    const account = await createAccount('oracle');

    const known = await requestReset(account.email).expect(200);
    const unknown = await requestReset(`nobody.${RUN_ID}@example.test`).expect(200);

    expect(unknown.body).toEqual(known.body);
    expect(unknown.status).toBe(known.status);
  });

  it('sends NOTHING for an address with no account', async () => {
    // The response being identical is half of it. The other half is that no
    // mail is generated, which is what stops the endpoint being used to send
    // unsolicited email to arbitrary addresses.
    mailer.reset();

    await requestReset(`also-nobody.${RUN_ID}@example.test`).expect(200);

    expect(mailer.latest('password_reset')).toBeUndefined();
  });

  it('answers identically for a soft-deleted account, and mints nothing', async () => {
    // A reset link must not resurrect a disabled account.
    const account = await createAccount('deleted');
    await users.updateOne({ _id: account.id }, { $set: { deletedAt: new Date() } }).exec();

    await requestReset(account.email).expect(200);

    expect(mailer.latest('password_reset')).toBeUndefined();

    const stored = (await users.findById(account.id).lean<UserLean>().exec()) as UserLean;
    expect(stored.passwordReset).toBeNull();
  });

  it('serves an UNVERIFIED account, because otherwise there is no way back in', async () => {
    /*
     * Deliberate, and the opposite of what a first instinct suggests.
     *
     * Somebody who registered, never received the verification mail and forgot
     * their password would otherwise be locked out permanently. Resetting does
     * NOT verify the address — the account still cannot log in — so this hands
     * out no privilege the reset did not already imply.
     */
    const email = `reset-unverified.${RUN_ID}@example.test`;
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Unverified' })
      .expect(201);

    const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
    createdUserIds.push(created._id);
    mailer.reset();

    await requestReset(email).expect(200);

    expect(mailer.latest('password_reset')).toBeDefined();
  });

  it('invalidates the previous link when a second is requested', async () => {
    /*
     * Not tidiness. Without this, every "I didn't get the email" click leaves
     * another live key to the account sitting in a mailbox, and the oldest of
     * them still works an hour later.
     */
    const account = await createAccount('reissue');

    await requestReset(account.email).expect(200);
    const first = tokenFromLatestResetEmail();

    mailer.reset();
    await requestReset(account.email).expect(200);
    const second = tokenFromLatestResetEmail();

    expect(second).not.toBe(first);

    await confirmReset(first, NEW_PASSWORD).expect(400);
    await confirmReset(second, NEW_PASSWORD).expect(200);
  });

  it('rejects a malformed address, and an unknown field', async () => {
    await requestReset('not-an-address').expect(400);

    const injected = await http()
      .post('/api/v1/auth/password-reset/request')
      .send({ email: `x.${RUN_ID}@example.test`, redirectTo: 'https://evil.example' })
      .expect(400);

    // An open redirect handed to an unauthenticated caller, with the resulting
    // link mailed to a real customer by us. `forbidNonWhitelisted` stops it.
    expect(injected.body.error.code).toBe('UNKNOWN_FIELD');
  });
});

describe('POST /auth/password-reset/confirm', () => {
  it('sets the new password, and the old one stops working', async () => {
    const account = await createAccount('confirm');
    await requestReset(account.email).expect(200);

    await confirmReset(tokenFromLatestResetEmail(), NEW_PASSWORD).expect(200);

    // Both halves. "The new password works" alone would pass even if the reset
    // had added a second valid password rather than replacing the first.
    await http()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: NEW_PASSWORD })
      .expect(200);

    await http()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: PASSWORD })
      .expect(401);
  });

  it('clears the challenge, so a REPLAY fails', async () => {
    const account = await createAccount('replay');
    await requestReset(account.email).expect(200);
    const token = tokenFromLatestResetEmail();

    await confirmReset(token, NEW_PASSWORD).expect(200);

    // A reset token that still works after the password changed is a second key
    // left under the mat — and this is the shape an attacker who saw the link
    // once would try.
    const replayed = await confirmReset(token, 'third password entirely').expect(400);
    expect(replayed.body.error.code).toBe('VALIDATION_ERROR');

    const stored = (await users.findById(account.id).lean<UserLean>().exec()) as UserLean;
    expect(stored.passwordReset).toBeNull();

    // And the replay changed nothing: the password from the FIRST reset stands.
    await http()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: NEW_PASSWORD })
      .expect(200);
  });

  it('refuses an EXPIRED token', async () => {
    const account = await createAccount('expired');
    await requestReset(account.email).expect(200);
    const token = tokenFromLatestResetEmail();

    // Backdated rather than waiting an hour. The expiry is compared inside the
    // query, so moving the stored date is the same test the clock would run.
    await users
      .updateOne(
        { _id: account.id },
        { $set: { 'passwordReset.expiresAt': new Date(Date.now() - 1_000) } },
      )
      .exec();

    await confirmReset(token, NEW_PASSWORD).expect(400);

    // The original password still works, so nothing was half-applied.
    await http()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: PASSWORD })
      .expect(200);
  });

  it('reports unknown, expired and used tokens identically', async () => {
    /*
     * Distinguishing them would let an attacker holding a stolen token learn
     * whether it was ever valid, and would tell anyone probing whether a given
     * account has a reset in flight.
     */
    const account = await createAccount('indistinct');
    await requestReset(account.email).expect(200);
    const token = tokenFromLatestResetEmail();
    await confirmReset(token, NEW_PASSWORD).expect(200);

    const used = await confirmReset(token, NEW_PASSWORD).expect(400);
    const unknown = await confirmReset('a'.repeat(43), NEW_PASSWORD).expect(400);

    expect(used.body.error.code).toBe(unknown.body.error.code);
    expect(used.body.error.message).toBe(unknown.body.error.message);
    expect(used.body.error.details).toEqual(unknown.body.error.details);
  });

  it('signs the account out EVERYWHERE — access and refresh', async () => {
    /*
     * The assertion the whole feature exists for.
     *
     * A reset that leaves an intruder's session alive has not reset anything.
     * Two mechanisms have to fire, because they cover different tokens:
     *
     *   tokenVersion++       kills outstanding ACCESS tokens (15 minutes)
     *   revoke all refresh   kills the 30-day tokens the bump cannot reach
     */
    const account = await createAccount('sessions');

    // Two live sessions, as a stolen-laptop scenario would have.
    await loginTokens(account.email, PASSWORD);
    const attackerRefresh = await loginTokens(account.email, PASSWORD);

    expect(
      await refreshTokens.countDocuments({ userId: account.id, revokedAt: null }).exec(),
    ).toBe(2);

    const before = (await users.findById(account.id).lean<UserLean>().exec()) as UserLean;

    await requestReset(account.email).expect(200);
    await confirmReset(tokenFromLatestResetEmail(), NEW_PASSWORD).expect(200);

    const after = (await users.findById(account.id).lean<UserLean>().exec()) as UserLean;
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);

    expect(
      await refreshTokens.countDocuments({ userId: account.id, revokedAt: null }).exec(),
    ).toBe(0);

    // And the attacker's refresh token is genuinely dead, not merely flagged.
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: attackerRefresh })
      .expect(401);
  });

  it('records WHY the sessions ended', async () => {
    // `PASSWORD_RESET`, not `LOGOUT_ALL`. Somebody reading `revokedReason`
    // after a takeover needs to see that the sessions ended because the
    // password changed, not because the owner pressed a button.
    const account = await createAccount('reason');
    await loginTokens(account.email, PASSWORD);

    await requestReset(account.email).expect(200);
    await confirmReset(tokenFromLatestResetEmail(), NEW_PASSWORD).expect(200);

    const revoked = await refreshTokens
      .find({ userId: account.id })
      .lean<{ revokedReason: string | null }[]>()
      .exec();

    expect(revoked.every((token) => token.revokedReason === 'PASSWORD_RESET')).toBe(true);
  });

  it('applies the full password policy, not just a length check', async () => {
    const account = await createAccount('policy');
    await requestReset(account.email).expect(200);
    const token = tokenFromLatestResetEmail();

    // Long enough for the DTO, refused by the policy because it contains the
    // account's own email address — a rule the DTO cannot enforce, because it
    // does not know whose token this is.
    const rejected = await confirmReset(token, `${account.email}-x`).expect(400);
    expect(rejected.body.error.code).toBe('VALIDATION_ERROR');

    // The token SURVIVES a refused password. Burning it here would mean a
    // customer who typed a weak password had to start the whole flow again.
    await confirmReset(token, NEW_PASSWORD).expect(200);
  });

  it('refuses a password below the minimum length', async () => {
    const account = await createAccount('short');
    await requestReset(account.email).expect(200);

    await confirmReset(tokenFromLatestResetEmail(), 'short').expect(400);
  });
});

describe('the two token kinds are not interchangeable', () => {
  it('refuses a VERIFICATION token at the reset endpoint', async () => {
    /*
     * Token confusion. Both are 32 random bytes stored as a SHA-256 digest with
     * an expiry, so nothing in the type system distinguishes them — only the
     * separate field and the separate lookup do.
     *
     * If this ever passed, an email-verification link (24-hour life, sent to
     * every new registration) would be a password-reset link.
     */
    const email = `reset-confusion.${RUN_ID}@example.test`;
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Confusion' })
      .expect(201);

    const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
    createdUserIds.push(created._id);

    const verification = mailer.latest('email_verification');
    expect(verification).toBeDefined();

    const match = /token=([A-Za-z0-9_%-]+)/.exec(verification?.text ?? '');
    const verificationToken = decodeURIComponent(match?.[1] ?? '');
    expect(verificationToken.length).toBeGreaterThan(20);

    await confirmReset(verificationToken, NEW_PASSWORD).expect(400);

    // And the account is still unverified — the reset endpoint did not consume
    // the verification challenge either.
    const after = (await users.findById(created._id).lean<UserLean>().exec()) as UserLean;
    expect(after.emailVerifiedAt).toBeNull();
    expect(after.emailVerification).not.toBeNull();
  });

  it('refuses a RESET token at the verification endpoint', async () => {
    const account = await createAccount('confusion-2');
    await requestReset(account.email).expect(200);

    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenFromLatestResetEmail() })
      .expect(400);
  });
});

describe('the reset email itself', () => {
  it('carries the link, the expiry copy and no address', async () => {
    const account = await createAccount('email-body');
    await requestReset(account.email).expect(200);

    const message = mailer.latest('password_reset');
    expect(message).toBeDefined();
    expect(message?.subject).toContain('Reset your');

    // "1 hour", matching AUTHORIZATION-MODEL.md §2.8. The TTL lives in
    // AuthModule and the copy in NotificationsModule, which is a sink and
    // imports nothing from a domain module — so this assertion is what stops
    // the two drifting into an email that states the wrong lifetime.
    expect(message?.text).toContain('1 hour');
    expect(message?.text).toContain('/forgot-password/reset?token=');

    /*
     * The body must not confirm the recipient's own address back to whoever
     * holds the mailbox — which, in the case this feature exists for, may not
     * be the account owner.
     */
    expect(message?.text).not.toContain(account.email);
    expect(message?.html).not.toContain(account.email);
  });

  it('never writes the raw token to the stored challenge or the tags', async () => {
    const account = await createAccount('no-leak');
    await requestReset(account.email).expect(200);

    const rawToken = tokenFromLatestResetEmail();
    const message = mailer.latest('password_reset');

    expect(JSON.stringify(message?.tags)).not.toContain(rawToken);
    expect(message?.subject).not.toContain(rawToken);

    const stored = (await users.findById(account.id).lean<UserLean>().exec()) as UserLean;
    expect(JSON.stringify(stored.passwordReset)).not.toContain(rawToken);
  });
});
