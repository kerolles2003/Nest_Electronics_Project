import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EGYPTIAN_GOVERNORATES } from '../../src/common/constants/governorates';
import { validationExceptionFactory } from '../../src/common/pipes/validation-exception.factory';
import { AuditAction, AuditEntityType } from '../../src/modules/audit/domain/audit-action';
import { AuditLog } from '../../src/modules/audit/infrastructure/schemas/audit-log.schema';
import { FulfilmentService } from '../../src/modules/fulfilment/fulfilment.service';
import {
  ShippingRate,
  type ShippingRateLean,
} from '../../src/modules/fulfilment/infrastructure/schemas/shipping-rate.schema';
import { RefreshToken } from '../../src/modules/auth/infrastructure/schemas/refresh-token.schema';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'nickel vanadium wire';
const USER_AGENT = `ShippingRateSuite/1.0 (${RUN_ID})`;

let app: INestApplication;
let users: Model<User>;
let refreshTokens: Model<RefreshToken>;
let shippingRates: Model<ShippingRate>;
let auditLogs: Model<AuditLog>;
let fulfilment: FulfilmentService;

const createdUserIds: Types.ObjectId[] = [];
let initialCairoFee: number;

interface Account {
  readonly id: Types.ObjectId;
  readonly token: string;
  readonly email: string;
}

let staff: Account;
let customer: Account;

function http(): request.Agent {
  return request(app.getHttpServer());
}

function bearer(account: Account): [string, string] {
  return ['Authorization', `Bearer ${account.token}`];
}

async function createAccount(label: string, role: Role): Promise<Account> {
  const email = `ship-${label}.${RUN_ID}@example.test`;
  const fullName = `Shipping ${label}`;

  await http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName })
    .expect(201);

  await users.updateOne({ email }, { $set: { emailVerifiedAt: new Date(), role } }).exec();

  const created = (await users.findOne({ email }).lean<UserLean>().exec()) as UserLean;
  createdUserIds.push(created._id);

  const login = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  const token = login.body.data.accessToken as string;

  return { id: created._id, token, email };
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
  shippingRates = app.get<Model<ShippingRate>>(getModelToken(ShippingRate.name));
  auditLogs = app.get<Model<AuditLog>>(getModelToken(AuditLog.name));
  fulfilment = app.get<FulfilmentService>(FulfilmentService);

  staff = await createAccount('staff', Role.ADMIN);
  customer = await createAccount('customer', Role.CUSTOMER);

  // Capture original Cairo fee to restore in afterAll
  const cairo = await shippingRates.findOne({ governorate: 'Cairo' }).lean<ShippingRateLean>().exec();
  initialCairoFee = cairo?.fee ?? 5000;
}, 120_000);

afterAll(async () => {
  // Restore Cairo fee
  await shippingRates.updateOne({ governorate: 'Cairo' }, { $set: { fee: initialCairoFee } }).exec();

  if (createdUserIds.length > 0) {
    await auditLogs.deleteMany({ 'entity.id': { $in: createdUserIds } }).exec();
    await refreshTokens.deleteMany({ userId: { $in: createdUserIds } }).exec();
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  // Clean up audit rows created for shipping rates during this test
  await auditLogs.deleteMany({ 'entity.type': AuditEntityType.SHIPPING_RATE }).exec();

  await app.close();
});

describe('GET /admin/shipping-rates', () => {
  it('lists all 27 governorates in alphabetical order', async () => {
    const response = await http()
      .get('/api/v1/admin/shipping-rates')
      .set(...bearer(staff))
      .expect(200);

    expect(response.body.data).toHaveLength(27);

    const names = response.body.data.map((row: { governorate: string }) => row.governorate);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);

    // Every governorate from EGYPTIAN_GOVERNORATES is present
    for (const gov of EGYPTIAN_GOVERNORATES) {
      expect(names).toContain(gov);
    }

    const first = response.body.data[0];
    expect(first).toHaveProperty('governorate');
    expect(first).toHaveProperty('fee');
    expect(first).toHaveProperty('formattedFee');
    expect(first).toHaveProperty('updatedAt');
  });

  it('refuses an unauthenticated caller with 401', async () => {
    await http().get('/api/v1/admin/shipping-rates').expect(401);
  });

  it('refuses a customer with 403', async () => {
    await http()
      .get('/api/v1/admin/shipping-rates')
      .set(...bearer(customer))
      .expect(403);
  });
});

describe('GET /admin/shipping-rates/:governorate', () => {
  it('reads the rate for a single governorate', async () => {
    const response = await http()
      .get('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(staff))
      .expect(200);

    expect(response.body.data).toMatchObject({
      governorate: 'Cairo',
      fee: initialCairoFee,
      formattedFee: `${(initialCairoFee / 100).toFixed(2)} EGP`,
    });
  });

  it('rejects an unrecognised governorate with 400', async () => {
    await http()
      .get('/api/v1/admin/shipping-rates/Atlantis')
      .set(...bearer(staff))
      .expect(400);
  });
});

describe('PATCH /admin/shipping-rates/:governorate', () => {
  it('updates the delivery fee and changes the next quote immediately', async () => {
    const newFee = 7500;

    const response = await http()
      .patch('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(staff))
      .set('User-Agent', USER_AGENT)
      .send({ fee: newFee })
      .expect(200);

    expect(response.body.data).toMatchObject({
      governorate: 'Cairo',
      fee: newFee,
      formattedFee: '75.00 EGP',
    });

    // Verification: checkout quoting reflects the updated fee immediately without restart
    const quote = await fulfilment.quote('Cairo', 10000);
    expect(quote).toEqual({ fee: newFee, priced: true });

    // Verification: audit log was recorded
    const logs = await auditLogs
      .find({
        'entity.type': AuditEntityType.SHIPPING_RATE,
        'entity.label': 'Cairo',
        action: AuditAction.SHIPPING_RATE_CHANGED,
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]?.changes?.before).toMatchObject({ fee: initialCairoFee });
    expect(logs[0]?.changes?.after).toMatchObject({ fee: newFee });
    expect(logs[0]?.actor.id.toHexString()).toBe(staff.id.toHexString());
    expect(logs[0]?.userAgent).toBe(USER_AGENT);
  });

  it('accepts fee = 0 for free delivery', async () => {
    const response = await http()
      .patch('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(staff))
      .send({ fee: 0 })
      .expect(200);

    expect(response.body.data).toMatchObject({
      governorate: 'Cairo',
      fee: 0,
      formattedFee: '0.00 EGP',
    });

    const quote = await fulfilment.quote('Cairo', 10000);
    expect(quote).toEqual({ fee: 0, priced: true });
  });

  it('does not write an audit row for a no-op update', async () => {
    // Current fee is 0 from previous test
    const countBefore = await auditLogs.countDocuments({
      'entity.type': AuditEntityType.SHIPPING_RATE,
      'entity.label': 'Cairo',
    }).exec();

    await http()
      .patch('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(staff))
      .send({ fee: 0 })
      .expect(200);

    const countAfter = await auditLogs.countDocuments({
      'entity.type': AuditEntityType.SHIPPING_RATE,
      'entity.label': 'Cairo',
    }).exec();

    expect(countAfter).toBe(countBefore);
  });

  it('rejects a negative fee with 400', async () => {
    await http()
      .patch('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(staff))
      .send({ fee: -100 })
      .expect(400);
  });

  it('rejects a fractional fee with 400', async () => {
    await http()
      .patch('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(staff))
      .send({ fee: 50.5 })
      .expect(400);
  });

  it('rejects an unknown field with 400 UNKNOWN_FIELD', async () => {
    const response = await http()
      .patch('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(staff))
      .send({ fee: 5000, extra: 'forbidden' })
      .expect(400);

    expect(response.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses a CUSTOMER with 403', async () => {
    await http()
      .patch('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(customer))
      .send({ fee: 5000 })
      .expect(403);
  });
});

describe('DELETE /admin/shipping-rates/:governorate', () => {
  it('refuses row deletion with 409 CANNOT_DELETE_SHIPPING_RATE', async () => {
    const response = await http()
      .delete('/api/v1/admin/shipping-rates/Cairo')
      .set(...bearer(staff))
      .expect(409);

    expect(response.body.error.code).toBe('CANNOT_DELETE_SHIPPING_RATE');

    // Asserts that the document is still present in the database
    const cairo = await shippingRates.findOne({ governorate: 'Cairo' }).lean().exec();
    expect(cairo).not.toBeNull();
  });
});
