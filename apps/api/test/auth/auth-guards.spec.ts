import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { authConfig, type AuthConfig } from '../../src/config/auth.config';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * The two controls that are OFF in the functional suite, proven here with the
 * real guards live: rate limiting, and the email-verification requirement.
 *
 * A separate application instance is used precisely because
 * `@nestjs/throttler`'s in-memory storage is per-instance — so this suite's
 * counters cannot exhaust another suite's budget, and vice versa.
 */

const RUN_ID = randomUUID();
const PASSWORD = 'brass thermionic valve';

let app: INestApplication;
let users: Model<User>;
let refreshTokens: Model<RefreshToken>;
let realConfig: AuthConfig;
const createdUserIds: Types.ObjectId[] = [];

function http(): request.Agent {
  return request(app.getHttpServer());
}

/**
 * Boots an app, optionally with one auth-config field replaced.
 *
 * `compile()` is called exactly ONCE. An earlier version compiled twice — once
 * to read the real configuration and once with the override — and each compile
 * opens its own database connection, so the discarded one leaked a handle that
 * kept Jest alive until the suite timed out.
 */
async function bootTestApp(overrideConfig?: Partial<AuthConfig>): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });

  if (overrideConfig !== undefined) {
    // `realConfig` comes from the already-booted shared app, so no second
    // module has to be compiled just to read it.
    builder.overrideProvider(authConfig.KEY).useValue({ ...realConfig, ...overrideConfig });
  }

  const created = (await builder.compile()).createNestApplication();

  created.setGlobalPrefix('api');
  created.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  created.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  await created.init();
  return created;
}

beforeAll(async () => {
  app = await bootTestApp();
  users = app.get<Model<User>>(getModelToken(User.name));
  refreshTokens = app.get<Model<RefreshToken>>(getModelToken(RefreshToken.name));
  realConfig = app.get<AuthConfig>(authConfig.KEY);
}, 60_000);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    // Sessions first: the verification test ends with a successful login, so
    // deleting only the users would strand its refresh token.
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  const connection = app.get<Connection>(getConnectionToken());
  await app.close();
  await connection.close();
}, 60_000);

describe('rate limiting', () => {
  it('caps registration at 3 per hour and answers with the frozen envelope', async () => {
    const attempt = (n: number): request.Test =>
      http()
        .post('/api/v1/auth/register')
        .send({
          email: `throttle-${String(n)}-${RUN_ID}@example.test`,
          password: PASSWORD,
          fullName: 'Throttle Test',
        });

    for (const n of [1, 2, 3]) {
      await attempt(n).expect(201);
    }

    const blocked = await attempt(4).expect(429);

    expect(blocked.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    // Frozen requirement: a 429 tells the client how long to wait.
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // The library's own exception shape would be a second response format.
    expect(blocked.body.error.requestId).toEqual(expect.any(String));
    expect(blocked.body.error.timestamp).toEqual(expect.any(String));

    for (const n of [1, 2, 3]) {
      const created = await users
        .findOne({ email: `throttle-${String(n)}-${RUN_ID}@example.test` })
        .lean<UserLean>()
        .exec();
      if (created !== null) {
        createdUserIds.push(created._id);
      }
    }

    // The fourth request never reached the handler.
    expect(
      await users.findOne({ email: `throttle-4-${RUN_ID}@example.test` }).exec(),
    ).toBeNull();
  }, 60_000);

  it('scopes the login limit to IP AND email, so one address cannot lock out another', async () => {
    const victim = `throttle-victim-${RUN_ID}@example.test`;
    const bystander = `throttle-bystander-${RUN_ID}@example.test`;

    // Burn the victim's entire login budget from this IP.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await http().post('/api/v1/auth/login').send({ email: victim, password: 'wrong password!!' });
    }

    const victimBlocked = await http()
      .post('/api/v1/auth/login')
      .send({ email: victim, password: 'wrong password!!' })
      .expect(429);
    expect(victimBlocked.body.error.code).toBe('RATE_LIMIT_EXCEEDED');

    // A different address from the same IP still has its own budget. Keying on
    // IP alone would return 429 here and lock out everyone behind a NAT.
    const bystanderResponse = await http()
      .post('/api/v1/auth/login')
      .send({ email: bystander, password: 'wrong password!!' });

    expect(bystanderResponse.status).toBe(401);
    expect(bystanderResponse.body.error.code).toBe('INVALID_CREDENTIALS');
  }, 60_000);
});

describe('email verification requirement', () => {
  it('blocks login for an unverified account when the requirement is on', async () => {
    // The frozen production posture. Development runs with it off because email
    // delivery does not exist yet; the config schema refuses that in production.
    const strictApp = await bootTestApp({ requireEmailVerification: true });
    const email = `unverified-${RUN_ID}@example.test`;

    try {
      await request(strictApp.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD, fullName: 'Unverified Maker' })
        .expect(201);

      const created = await users.findOne({ email }).lean<UserLean>().exec();
      expect(created).not.toBeNull();
      createdUserIds.push((created as UserLean)._id);

      const blocked = await request(strictApp.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(403);

      // Reachable only WITH a correct password, so it informs the account
      // holder without informing an enumerator.
      expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

      // A wrong password on the same account still gives nothing away.
      const wrong = await request(strictApp.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'not the right password' })
        .expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

      // Verifying unblocks it.
      await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date() } }).exec();
      await request(strictApp.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
    } finally {
      const connection = strictApp.get<Connection>(getConnectionToken());
      await strictApp.close();
      await connection.close();
    }
  }, 90_000);
});
