import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * `PATCH /users/me`.
 *
 * Authority: PLAN.md §9 — the profile edit `/account/profile` needs before it
 * can migrate off Supabase.
 *
 * ## What is actually at risk here
 *
 * A profile update is an authenticated write to the user document — the same
 * document that holds `role`, `passwordHash`, `emailVerifiedAt` and
 * `tokenVersion`. So most of these cases are about what the endpoint must
 * REFUSE to write, not what it writes: a `{ $set: dto }` that looked innocent
 * would be a privilege-escalation endpoint.
 */

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'brass thermionic valve';
const PROFILE = '/api/v1/users/me';

let app: INestApplication;
let users: Model<User>;
let refreshTokens: Model<RefreshToken>;

const createdUserIds: Types.ObjectId[] = [];

function http(): request.Agent {
  return request(app.getHttpServer());
}

interface Account {
  readonly id: Types.ObjectId;
  readonly email: string;
  readonly token: string;
}

async function createAccount(label: string, role: Role = Role.CUSTOMER): Promise<Account> {
  const email = `profile-${label}.${RUN_ID}@example.test`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName: `Profile ${label}` })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http()
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  return { id: created._id, email, token: login.body.data.accessToken as string };
}

function patch(account: Account, body: object): request.Test {
  return http().patch(PROFILE).set('Authorization', `Bearer ${account.token}`).send(body);
}

/** The document as MongoDB holds it — not what a handler chose to say. */
async function stored(id: Types.ObjectId): Promise<UserLean> {
  return (await users.findById(id).lean<UserLean>().exec()) as UserLean;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  await app.close();
});

describe('what it updates', () => {
  it('changes the display name and returns the whole profile', async () => {
    const account = await createAccount('name');

    const response = await patch(account, { fullName: 'Nadia Hassan' }).expect(200);

    expect(response.body.data.fullName).toBe('Nadia Hassan');
    expect(response.body.data.email).toBe(account.email);
    expect(response.body.data.role).toBe(Role.CUSTOMER);
    expect(response.body.data.id).toBe(account.id.toHexString());

    expect((await stored(account.id)).fullName).toBe('Nadia Hassan');
  });

  it('sets and then clears the phone number', async () => {
    /*
     * `null` is a real instruction here, distinct from omitting the key. A
     * truthiness check in the service would silently ignore it and leave the old
     * number on the account, which is the sort of bug a customer only finds when
     * a courier rings a number they meant to remove.
     */
    const account = await createAccount('phone');

    await patch(account, { phone: '01012345678' }).expect(200);
    expect((await stored(account.id)).phone).toBe('01012345678');

    const cleared = await patch(account, { phone: null }).expect(200);

    expect(cleared.body.data.phone).toBeNull();
    expect((await stored(account.id)).phone).toBeNull();
  });

  it('leaves an OMITTED field alone', async () => {
    // The property that makes this a PATCH rather than a PUT.
    const account = await createAccount('omit');

    await patch(account, { fullName: 'First Name', phone: '01098765432' }).expect(200);
    await patch(account, { fullName: 'Second Name' }).expect(200);

    const after = await stored(account.id);
    expect(after.fullName).toBe('Second Name');
    expect(after.phone).toBe('01098765432');
  });

  it('accepts an empty patch as a no-op', async () => {
    /*
     * A legal request that must not become an empty `$set`, which MongoDB
     * rejects outright. Answering with the current profile is the honest result
     * of "change nothing".
     */
    const account = await createAccount('empty');
    await patch(account, { fullName: 'Unchanged' }).expect(200);

    const response = await patch(account, {}).expect(200);

    expect(response.body.data.fullName).toBe('Unchanged');
  });

  it('trims whitespace rather than storing it', async () => {
    const account = await createAccount('trim');

    const response = await patch(account, { fullName: '   Spaced Out   ' }).expect(200);

    expect(response.body.data.fullName).toBe('Spaced Out');
  });
});

describe('what it refuses to write', () => {
  it('refuses `role`, which would be privilege escalation', async () => {
    const account = await createAccount('role');

    const response = await patch(account, { role: Role.SUPER_ADMIN }).expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect((await stored(account.id)).role).toBe(Role.CUSTOMER);
  });

  it('refuses `email`, which would be account takeover', async () => {
    /*
     * Changing the login identifier is not a profile edit. If it were allowed
     * here, one PATCH would move an account to an inbox the caller controls —
     * and the new address would never have been proven.
     */
    const account = await createAccount('email');

    const response = await patch(account, { email: `stolen.${RUN_ID}@example.test` }).expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    expect((await stored(account.id)).email).toBe(account.email);
  });

  it('refuses the credential and server-owned fields', async () => {
    const account = await createAccount('server-owned');
    const before = await stored(account.id);

    for (const injected of [
      { passwordHash: 'not-a-hash' },
      { emailVerifiedAt: new Date().toISOString() },
      { tokenVersion: 99 },
      { deletedAt: null },
      { addresses: [] },
      { _id: new Types.ObjectId().toHexString() },
      { createdAt: '2020-01-01T00:00:00.000Z' },
    ]) {
      const response = await patch(account, injected).expect(400);
      expect(response.body.error.code).toBe('UNKNOWN_FIELD');
    }

    const after = await stored(account.id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    expect(after.emailVerifiedAt).toEqual(before.emailVerifiedAt);
  });

  it('never returns the password hash or the token version', async () => {
    const account = await createAccount('projection');

    const response = await patch(account, { fullName: 'Projected' }).expect(200);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('tokenVersion');
    expect(body).not.toContain('emailVerification');
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

  it('refuses a name that is too short, too long, or the wrong type', async () => {
    const account = await createAccount('validation');

    await patch(account, { fullName: 'A' }).expect(400);
    await patch(account, { fullName: 'x'.repeat(121) }).expect(400);
    await patch(account, { fullName: 42 }).expect(400);
  });

  it('refuses a phone number that is not an Egyptian mobile', async () => {
    const account = await createAccount('phone-format');

    await patch(account, { phone: '+44 7700 900000' }).expect(400);
    await patch(account, { phone: '123' }).expect(400);

    expect((await stored(account.id)).phone).toBeNull();
  });
});

describe('who may call it', () => {
  it('refuses an unauthenticated request', async () => {
    await http().patch(PROFILE).send({ fullName: 'Anonymous' }).expect(401);
  });

  it('refuses a garbage bearer token', async () => {
    await http()
      .patch(PROFILE)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ fullName: 'Nope' })
      .expect(401);
  });

  it('refuses a staff account — a profile belongs to a CUSTOMER', async () => {
    const admin = await createAccount('admin', Role.ADMIN);

    // The token was minted BEFORE the role change in `createAccount`, so this
    // also confirms the guard reads the role from the token it was issued.
    const fresh = await http()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);

    await http()
      .patch(PROFILE)
      .set('Authorization', `Bearer ${fresh.body.data.accessToken as string}`)
      .send({ fullName: 'Administrator' })
      .expect(403);
  });

  it('answers 404 when the account was soft-deleted under a live token', async () => {
    /*
     * Reachable with a perfectly valid token: access tokens live 15 minutes and
     * are not revocable, so an account disabled a minute ago still presents one.
     *
     * 404 rather than 401 — the token is genuine, the subject is gone. A 401
     * would send the caller to sign in again with credentials that are also
     * gone.
     */
    const account = await createAccount('vanished');
    await users.updateOne({ _id: account.id }, { $set: { deletedAt: new Date() } }).exec();

    const response = await patch(account, { fullName: 'Ghost' }).expect(404);

    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('consistency with GET /auth/me', () => {
  it('returns the same profile the read endpoint does', async () => {
    /*
     * Two DTOs describe this shape — `UserProfileDto` here and `AuthUserDto` on
     * `/auth/me` — because moving one across modules would close a dependency
     * cycle and removing one is a breaking contract change. Duplication that
     * cannot drift is fine; this is the assertion that makes it so.
     */
    const account = await createAccount('parity');

    const patched = await patch(account, { fullName: 'Parity Check', phone: '01111111111' }).expect(200);

    const read = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${account.token}`)
      .expect(200);

    expect(read.body.data).toEqual(patched.body.data);
  });
});
