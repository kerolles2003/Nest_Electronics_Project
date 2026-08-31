import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { authConfig, type AuthConfig } from '../../src/config/auth.config';
import {
  RefreshToken,
  type RefreshTokenLean,
} from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * Authentication end-to-end, against the REAL application and the REAL Atlas
 * development database.
 *
 * Two deliberate choices:
 *
 *  1. THE RATE-LIMIT CEILING IS RAISED HERE, and only here. Registration is
 *     capped at 3/hour per IP, which this suite exceeds by design. The guard
 *     itself still runs — only its configured limit is replaced — and the real
 *     limits are proven in `auth-guards.spec.ts`, which leaves them intact.
 *
 *  2. ISOLATION IS BY runId, NOT BY WIPING. Every account this suite creates
 *     carries a per-run UUID in its address, and cleanup deletes exactly those
 *     ids. There is no `deleteMany({})` and no `drop()` anywhere: a test that
 *     can destroy data it did not create is a production incident waiting for
 *     someone to point it at the wrong database.
 */

const RUN_ID = randomUUID();
const PASSWORD = 'brass thermionic valve';

let app: INestApplication;
let users: Model<User>;
let refreshTokens: Model<RefreshToken>;
let jwt: JwtService;
let config: AuthConfig;

/** Every account created by this run, for targeted cleanup. */
const createdUserIds: Types.ObjectId[] = [];

/**
 * `label.<runId>@example.test`.
 *
 * The local part stays under 64 characters on purpose: that is the RFC limit
 * `@IsEmail` enforces, and exceeding it produces a 400 that looks like a
 * product bug but is a test-data bug.
 */
function emailFor(label: string): string {
  return `${label}.${RUN_ID}@example.test`;
}

function http(): request.Agent {
  return request(app.getHttpServer());
}

interface RegisterOptions {
  readonly verified?: boolean;
  readonly disabled?: boolean;
}

/** Registers an account and returns its email, recording it for cleanup. */
async function register(label: string, options: RegisterOptions = {}): Promise<string> {
  const email = emailFor(label);

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: 'Test Maker' })
    .expect(201);

  const created = await users.findOne({ email }).lean<UserLean>().exec();
  expect(created).not.toBeNull();
  createdUserIds.push((created as UserLean)._id);

  const updates: Record<string, unknown> = {};
  if (options.verified === true) {
    updates.emailVerifiedAt = new Date();
  }
  if (options.disabled === true) {
    updates.deletedAt = new Date();
  }
  if (Object.keys(updates).length > 0) {
    await users.updateOne({ email }, { $set: updates }).exec();
  }

  return email;
}

interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

async function login(email: string): Promise<TokenPair> {
  const response = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  return {
    accessToken: response.body.data.accessToken as string,
    refreshToken: response.body.data.refreshToken as string,
  };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // See note 1 above. The COUNTER is replaced, not the guard: the real
    // AppThrottlerGuard still runs, still builds its IP+email keys and still
    // owns the error envelope — it simply never sees a total that trips a
    // limit. Overriding the module options instead would not work, because the
    // per-route `@Throttle()` limits take precedence over them.
    .overrideProvider(getStorageToken())
    .useValue({
      increment: () =>
        Promise.resolve({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
    } satisfies ThrottlerStorage)
    .compile();

  app = moduleRef.createNestApplication();

  // The global prefix, versioning and validation pipe are applied in main.ts,
  // which a testing module does not run. Reproducing them here is what makes
  // this an end-to-end test of the REAL pipeline rather than of controllers in
  // isolation — the `forbidNonWhitelisted` assertions below depend on it.
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
  jwt = app.get(JwtService);
  config = app.get<AuthConfig>(authConfig.KEY);
}, 60_000);

afterAll(async () => {
  // Targeted cleanup: exactly the ids this run created, nothing else.
  if (createdUserIds.length > 0) {
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 60_000);

// ---------------------------------------------------------------------------

describe('POST /auth/register', () => {
  it('creates an account and returns NO session', async () => {
    const email = emailFor('register-ok');

    const response = await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Nadia Hassan', phone: '01012345678' })
      .expect(201);

    expect(response.body).toEqual({
      data: { message: expect.any(String), emailVerificationRequired: true },
    });

    // The frozen contract is explicit: registration issues no session.
    expect(JSON.stringify(response.body)).not.toContain('accessToken');
    expect(JSON.stringify(response.body)).not.toContain('refreshToken');

    const created = await users.findOne({ email }).lean<UserLean>().exec();
    expect(created).not.toBeNull();
    createdUserIds.push((created as UserLean)._id);

    // The server decides the role. It is not a field a client can influence.
    expect(created?.role).toBe('CUSTOMER');
    expect(created?.emailVerifiedAt).toBeNull();
  });

  it('stores a bcrypt hash and never the password', async () => {
    const email = emailFor('register-hash');
    await register('register-hash');

    const stored = await users.findOne({ email }).lean<UserLean>().exec();

    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
    // Cost factor actually applied, not merely configured.
    expect(stored?.passwordHash.slice(4, 6)).toBe(String(config.bcryptRounds));
  });

  it('stores the verification token HASHED, never in the clear', async () => {
    const email = await register('register-challenge');
    const stored = await users.findOne({ email }).lean<UserLean>().exec();

    expect(stored?.emailVerification).not.toBeNull();
    // SHA-256 hex.
    expect(stored?.emailVerification?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.emailVerification?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('normalises the email, so case cannot create a second account', async () => {
    const email = emailFor('register-case');

    await http()
      .post('/api/v1/auth/register')
      .send({ email: `  ${email.toUpperCase()} `, password: PASSWORD, fullName: 'Case Test' })
      .expect(201);

    const stored = await users.findOne({ email }).lean<UserLean>().exec();
    expect(stored).not.toBeNull();
    createdUserIds.push((stored as UserLean)._id);

    // The same address in a different case is a duplicate, not a new account.
    await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Case Test' })
      .expect(409);
  });

  it('rejects a duplicate email with DUPLICATE_EMAIL and no driver detail', async () => {
    const email = await register('register-dup');

    const response = await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Test Maker' })
      .expect(409);

    expect(response.body.error.code).toBe('DUPLICATE_EMAIL');
    // The leakage rule: no index name, no collection name, no driver text.
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('E11000');
    expect(body).not.toContain('user_email_unique');
    expect(body).not.toContain('users');
  });

  it('rejects a malformed email', async () => {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: PASSWORD, fullName: 'Test Maker' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toContainEqual(
      expect.objectContaining({ field: 'email' }),
    );
  });

  it.each([
    ['too short', 'short1234'],
    ['too common', 'password123'],
    ['the email address itself', 'nadia@example.test'],
  ])('rejects a password that is %s', async (label, password) => {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({
        email: label === 'the email address itself' ? 'nadia@example.test' : emailFor('pw-reject'),
        password,
        fullName: 'Test Maker',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    // The rejected password must not be echoed back in the error.
    expect(JSON.stringify(response.body)).not.toContain(password);
  });

  it('rejects a missing required field', async () => {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({ email: emailFor('no-name'), password: PASSWORD })
      .expect(400);

    expect(response.body.error.details).toContainEqual(
      expect.objectContaining({ field: 'fullName' }),
    );
  });

  it('rejects an empty string where a value is required', async () => {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({ email: emailFor('empty-name'), password: PASSWORD, fullName: '' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a privilege-escalation attempt with UNKNOWN_FIELD', async () => {
    // The direct regression test for the legacy field-injection class of
    // vulnerability. `role` is not a property of RegisterDto, so the attack has
    // no surface to land on.
    const response = await http()
      .post('/api/v1/auth/register')
      .send({
        email: emailFor('escalate'),
        password: PASSWORD,
        fullName: 'Test Maker',
        role: 'SUPER_ADMIN',
      })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect(response.body.error.details).toContainEqual(
      expect.objectContaining({ field: 'role' }),
    );

    expect(await users.findOne({ email: emailFor('escalate') }).exec()).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('POST /auth/login', () => {
  it('returns a token pair, explicit expiry and the canonical user', async () => {
    const email = await register('login-ok', { verified: true });

    const response = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    const { data } = response.body;

    expect(data.tokenType).toBe('Bearer');
    expect(data.accessToken).toEqual(expect.any(String));
    expect(data.refreshToken).toEqual(expect.any(String));
    // Flutter must never have to infer expiry from an undocumented convention.
    expect(data.expiresIn).toBe(config.accessTtlSeconds);
    expect(Date.parse(data.accessTokenExpiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(data.refreshTokenExpiresAt)).toBeGreaterThan(Date.now());

    expect(data.user).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      email,
      fullName: 'Test Maker',
      phone: null,
      role: 'CUSTOMER',
      emailVerified: true,
      // Set by THIS login: the field means "most recent successful sign-in",
      // and the response is issued after it is recorded.
      lastLoginAt: expect.any(String),
      createdAt: expect.any(String),
    });
  });

  it('never returns a password hash or any credential field', async () => {
    const email = await register('login-noleak', { verified: true });

    const response = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    const stored = await users.findOne({ email }).lean<UserLean>().exec();
    const body = JSON.stringify(response.body);

    expect(body).not.toContain(stored?.passwordHash);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('tokenVersion');
    expect(body).not.toContain('emailVerification');
    expect(body).not.toContain(PASSWORD);
  });

  it('records lastLoginAt', async () => {
    const email = await register('login-timestamp', { verified: true });
    await login(email);

    const stored = await users.findOne({ email }).lean<UserLean>().exec();
    expect(stored?.lastLoginAt).not.toBeNull();
  });

  it('answers a wrong password and an unknown email IDENTICALLY', async () => {
    const email = await register('login-safe', { verified: true });

    const wrongPassword = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'definitely not the password' })
      .expect(401);

    const unknownEmail = await http()
      .post('/api/v1/auth/login')
      .send({ email: emailFor('never-registered'), password: PASSWORD })
      .expect(401);

    // Same code AND same message. Anything that differs is an enumeration
    // oracle, however subtle.
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(wrongPassword.body.error.details).toBeUndefined();
    expect(unknownEmail.body.error.details).toBeUndefined();
  });

  it('takes comparable time for an unknown email and a wrong password', async () => {
    const email = await register('login-timing', { verified: true });

    // BOTH probes must FAIL. Timing a successful login against a failed one
    // would compare different amounts of work — success also inserts a refresh
    // token and reads the profile — and would prove nothing about the
    // enumeration oracle this defends against.
    const timeFailedLogin = async (address: string): Promise<number> => {
      const started = process.hrtime.bigint();
      await http()
        .post('/api/v1/auth/login')
        .send({ email: address, password: 'this password is wrong' })
        .expect(401);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    // Warm the connection so the first request's setup cost is not measured.
    await timeFailedLogin(email);

    const known = await timeFailedLogin(email);
    const unknown = await timeFailedLogin(emailFor('nonexistent'));

    // Without the dummy-hash comparison the unknown-email path returns almost
    // immediately while the known path pays for bcrypt, and the ratio is
    // enormous. This asserts they are within the same order of magnitude, which
    // is what defeats a timing oracle without making the test flaky on a busy
    // CI machine.
    expect(unknown).toBeGreaterThan(known / 4);
  });

  it('refuses a disabled account, but only AFTER the password is verified', async () => {
    const email = await register('login-disabled', { verified: true, disabled: true });

    const correctPassword = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(correctPassword.body.error.code).toBe('ACCOUNT_DISABLED');

    // A wrong password on a disabled account reveals nothing about it existing.
    const wrongPassword = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong password entirely' })
      .expect(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------

describe('GET /auth/me', () => {
  it('returns the canonical user for a valid token', async () => {
    const email = await register('me-ok', { verified: true });
    const tokens = await login(email);

    const response = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);

    expect(response.body.data.email).toBe(email);
    expect(response.body.data.role).toBe('CUSTOMER');
    expect(Object.keys(response.body.data).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerified',
      'fullName',
      'id',
      'lastLoginAt',
      'phone',
      'role',
    ]);
  });

  it('rejects a missing token with UNAUTHENTICATED', async () => {
    const response = await http().get('/api/v1/auth/me').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a non-bearer scheme', async () => {
    const response = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', 'Basic YWRtaW46YWRtaW4=')
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed token with TOKEN_INVALID', async () => {
    const response = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a token signed with the wrong key', async () => {
    // Forgery attempt: correct shape, wrong signature.
    const forged = new JwtService({ secret: randomBytes(48).toString('hex') }).sign({
      sub: new Types.ObjectId().toHexString(),
      role: 'SUPER_ADMIN',
      tv: 1,
    });

    const response = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects an EXPIRED token with TOKEN_EXPIRED, distinctly from invalid', async () => {
    const email = await register('me-expired', { verified: true });
    const user = await users.findOne({ email }).lean<UserLean>().exec();

    // Correctly signed, already expired — the client should refresh, not sign out.
    const expired = jwt.sign(
      { sub: (user as UserLean)._id.toHexString(), role: 'CUSTOMER', tv: 1 },
      { expiresIn: -10 },
    );

    const response = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token whose subject no longer resolves', async () => {
    const orphan = jwt.sign(
      { sub: new Types.ObjectId().toHexString(), role: 'CUSTOMER', tv: 1 },
    );

    const response = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${orphan}`)
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('carries only the four intended claims — no PII in the token', async () => {
    const email = await register('me-claims', { verified: true });
    const tokens = await login(email);

    const claims = jwt.verify<Record<string, unknown>>(tokens.accessToken);

    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'role', 'sub', 'tv']);
    // A JWT is base64, not encryption. Anything here is readable by anyone.
    expect(JSON.stringify(claims)).not.toContain(email);
  });
});

// ---------------------------------------------------------------------------

describe('POST /auth/refresh', () => {
  it('issues a NEW pair and invalidates the presented token', async () => {
    const email = await register('refresh-ok', { verified: true });
    const first = await login(email);

    const response = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);

    const rotated = response.body.data;

    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.accessToken).toEqual(expect.any(String));
    expect(rotated.tokenType).toBe('Bearer');

    // The new access token works.
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(200);

    // The old refresh token is dead — this is what "single use" means.
    const stored = await refreshTokens
      .findOne({ tokenHash: createHash('sha256').update(first.refreshToken).digest('hex') })
      .lean<RefreshTokenLean>()
      .exec();
    expect(stored?.revokedAt).not.toBeNull();
    expect(stored?.revokedReason).toBe('ROTATED');
  });

  it('keeps the rotated token in the SAME family', async () => {
    const email = await register('refresh-family', { verified: true });
    const first = await login(email);

    const response = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);

    const digest = (token: string): string =>
      createHash('sha256').update(token).digest('hex');

    const before = await refreshTokens
      .findOne({ tokenHash: digest(first.refreshToken) })
      .lean<RefreshTokenLean>()
      .exec();
    const after = await refreshTokens
      .findOne({ tokenHash: digest(response.body.data.refreshToken as string) })
      .lean<RefreshTokenLean>()
      .exec();

    expect(after?.familyId.toHexString()).toBe(before?.familyId.toHexString());
  });

  it('treats a REPLAYED token as theft and revokes the whole family', async () => {
    const email = await register('refresh-replay', { verified: true });
    const first = await login(email);

    const second = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);

    const liveBefore = await refreshTokens
      .countDocuments({ tokenHash: { $exists: true }, revokedAt: null })
      .exec();
    expect(liveBefore).toBeGreaterThan(0);

    // Present the already-rotated token a second time.
    const replay = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);

    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // Revoking only the replayed token would be useless — the thief already
    // holds the rotated one. The whole chain must be dead, INCLUDING the token
    // the legitimate holder is using.
    const rotatedToken = second.body.data.refreshToken as string;
    const stillLive = await refreshTokens
      .findOne({ tokenHash: createHash('sha256').update(rotatedToken).digest('hex') })
      .lean<RefreshTokenLean>()
      .exec();

    expect(stillLive?.revokedAt).not.toBeNull();
    expect(stillLive?.revokedReason).toBe('REPLAY_DETECTED');

    // And it genuinely cannot be used any more.
    await http().post('/api/v1/auth/refresh').send({ refreshToken: rotatedToken }).expect(401);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: randomBytes(32).toString('base64url') })
      .expect(401);

    expect(response.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('rejects an EXPIRED refresh token', async () => {
    const email = await register('refresh-expired', { verified: true });
    const user = await users.findOne({ email }).lean<UserLean>().exec();

    // Planted directly, because waiting 30 days is not a test strategy.
    const raw = randomBytes(32).toString('base64url');
    await refreshTokens.create({
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      userId: (user as UserLean)._id,
      familyId: new Types.ObjectId(),
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      revokedReason: null,
    });

    const response = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: raw })
      .expect(401);

    expect(response.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('refuses to refresh a session belonging to a disabled account', async () => {
    const email = await register('refresh-disabled', { verified: true });
    const tokens = await login(email);

    await users.updateOne({ email }, { $set: { deletedAt: new Date() } }).exec();

    // Refresh must not be a way around the check login performs.
    const response = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);

    expect(response.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('stores refresh tokens HASHED — the raw value is never persisted', async () => {
    const email = await register('refresh-hashing', { verified: true });
    const tokens = await login(email);
    const user = await users.findOne({ email }).lean<UserLean>().exec();

    const stored = await refreshTokens
      .find({ userId: (user as UserLean)._id })
      .lean<RefreshTokenLean[]>()
      .exec();

    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(
      createHash('sha256').update(tokens.refreshToken).digest('hex'),
    );
    // The decisive assertion: nothing in the document is the token itself.
    expect(JSON.stringify(stored)).not.toContain(tokens.refreshToken);
  });

  it('rejects a malformed refresh request shape', async () => {
    await http().post('/api/v1/auth/refresh').send({}).expect(400);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: '' }).expect(400);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: randomBytes(32).toString('base64url'), userId: 'x' })
      .expect(400);
  });
});

// ---------------------------------------------------------------------------

describe('POST /auth/logout and /auth/logout-all', () => {
  it('revokes the presented refresh token', async () => {
    const email = await register('logout-one', { verified: true });
    const tokens = await login(email);

    await http().post('/api/v1/auth/logout').send({ refreshToken: tokens.refreshToken }).expect(200);

    const response = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);

    // Logout revokes rather than deletes, so a later presentation is correctly
    // seen as a replay rather than as an unknown token.
    expect(response.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('is idempotent', async () => {
    const email = await register('logout-idempotent', { verified: true });
    const tokens = await login(email);

    await http().post('/api/v1/auth/logout').send({ refreshToken: tokens.refreshToken }).expect(200);
    await http().post('/api/v1/auth/logout').send({ refreshToken: tokens.refreshToken }).expect(200);
    // An entirely unknown token is not an error either.
    await http()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: randomBytes(32).toString('base64url') })
      .expect(200);
  });

  it('revokes every session on logout-all', async () => {
    const email = await register('logout-all', { verified: true });
    const first = await login(email);
    const second = await login(email);
    const third = await login(email);

    const user = await users.findOne({ email }).lean<UserLean>().exec();
    expect(
      await refreshTokens.countDocuments({ userId: (user as UserLean)._id, revokedAt: null }).exec(),
    ).toBe(3);

    await http()
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200);

    expect(
      await refreshTokens.countDocuments({ userId: (user as UserLean)._id, revokedAt: null }).exec(),
    ).toBe(0);

    for (const tokens of [first, second, third]) {
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);
    }
  });

  it('requires authentication for logout-all', async () => {
    const response = await http().post('/api/v1/auth/logout-all').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------

describe('email verification', () => {
  it('verifies with a valid token and makes it single-use', async () => {
    // The raw token is not recoverable from the database by design, so the
    // challenge is minted through the same service registration uses and
    // planted on the account.
    const email = await register('verify-ok');
    const user = await users.findOne({ email }).lean<UserLean>().exec();

    const raw = randomBytes(32).toString('base64url');
    await users
      .updateOne(
        { email },
        {
          $set: {
            emailVerification: {
              tokenHash: createHash('sha256').update(raw).digest('hex'),
              expiresAt: new Date(Date.now() + 60_000),
            },
          },
        },
      )
      .exec();

    await http().post('/api/v1/auth/verify-email').send({ token: raw }).expect(200);

    const verified = await users.findById((user as UserLean)._id).lean<UserLean>().exec();
    expect(verified?.emailVerifiedAt).not.toBeNull();
    expect(verified?.emailVerification).toBeNull();

    // Replaying the token does nothing — the challenge is gone.
    await http().post('/api/v1/auth/verify-email').send({ token: raw }).expect(400);
  });

  it('rejects an expired verification token', async () => {
    const email = await register('verify-expired');
    const raw = randomBytes(32).toString('base64url');

    await users
      .updateOne(
        { email },
        {
          $set: {
            emailVerification: {
              tokenHash: createHash('sha256').update(raw).digest('hex'),
              expiresAt: new Date(Date.now() - 1000),
            },
          },
        },
      )
      .exec();

    await http().post('/api/v1/auth/verify-email').send({ token: raw }).expect(400);
  });

  it('answers resend identically for a known and an unknown address', async () => {
    const email = await register('verify-resend');

    const known = await http()
      .post('/api/v1/auth/resend-verification')
      .send({ email })
      .expect(200);

    const unknown = await http()
      .post('/api/v1/auth/resend-verification')
      .send({ email: emailFor('never-registered-resend') })
      .expect(200);

    // Identical, or this endpoint becomes a password-free existence oracle.
    expect(known.body).toEqual(unknown.body);
  });

  it('replaces the previous challenge on resend', async () => {
    const email = await register('verify-replace');
    const before = await users.findOne({ email }).lean<UserLean>().exec();

    await http().post('/api/v1/auth/resend-verification').send({ email }).expect(200);

    const after = await users.findOne({ email }).lean<UserLean>().exec();
    expect(after?.emailVerification?.tokenHash).not.toBe(before?.emailVerification?.tokenHash);
  });
});

// ---------------------------------------------------------------------------

describe('the catalogue stays public now that auth is global', () => {
  it.each([
    '/api/v1/health',
    '/api/v1/products?limit=1',
    '/api/v1/categories',
    '/api/v1/categories/tree',
    '/api/v1/brands',
  ])('%s needs no token', async (path) => {
    await http().get(path).expect(200);
  });
});
