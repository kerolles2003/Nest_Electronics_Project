import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { EGYPTIAN_GOVERNORATES } from '../../src/common/constants/governorates';
import { SEED_SHIPPING_RATES } from '../../src/database/seed/shipping.seed-data';
import { FulfilmentService } from '../../src/modules/fulfilment/fulfilment.service';
import { ShippingRateRepository } from '../../src/modules/fulfilment/infrastructure/repositories/shipping-rate.repository';
import {
  ShippingRate,
  type ShippingRateLean,
} from '../../src/modules/fulfilment/infrastructure/schemas/shipping-rate.schema';

/**
 * The `shippingRates` collection itself — the half `fulfilment.spec.ts` stands
 * in for.
 *
 * That suite proves the POLICY against a map. This one proves the parts a map
 * cannot: that the collection exists with the frozen shape, that the unique
 * index is real, that the seed installs 27 rows and does not overwrite an
 * edited one, and that a real `FulfilmentService` resolved out of the container
 * reads them.
 *
 * The rows are shared state — the development database holds one table, and
 * this suite must leave it exactly as it found it. Every case that mutates a
 * row records the original and restores it.
 */

let app: INestApplication;
let rates: Model<ShippingRate>;
let fulfilment: FulfilmentService;
let repository: ShippingRateRepository;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  await app.init();

  rates = app.get<Model<ShippingRate>>(getModelToken(ShippingRate.name));
  fulfilment = app.get(FulfilmentService);
  repository = app.get(ShippingRateRepository);
});

afterAll(async () => {
  await app.close();
});

describe('the collection', () => {
  it('holds exactly one row per governorate', async () => {
    /*
     * 27, not "at least 27". A 28th row would mean a governorate priced twice,
     * and which fee a customer paid would depend on which document the index
     * happened to return first.
     */
    const rows = await repository.findAll();

    expect(rows).toHaveLength(EGYPTIAN_GOVERNORATES.length);
    expect(rows.map((row) => row.governorate).sort()).toEqual(
      [...EGYPTIAN_GOVERNORATES].sort(),
    );
  });

  it('has the unique index, and it actually rejects a duplicate', async () => {
    /*
     * Asserted by USE, not by reading `listIndexes`.
     *
     * An index can exist under the right name without `unique` — measured in
     * `test/infrastructure/index-health.spec.ts`, where such a collection
     * cheerfully stored two duplicate documents. The only assertion that cannot
     * be satisfied by a lookalike is inserting the duplicate and being refused.
     */
    await expect(
      rates.create({ governorate: 'Cairo', fee: 999, freeShippingThreshold: null }),
    ).rejects.toMatchObject({ code: 11000 });

    // And nothing was stored by trying.
    expect(await rates.countDocuments({ governorate: 'Cairo' }).exec()).toBe(1);
  });

  it('refuses a governorate outside the closed list', async () => {
    // The schema enum is the second half of the guarantee that makes a
    // no-fallback table safe: a row can only exist for a real governorate, so
    // the table cannot drift away from the addresses that reference it.
    await expect(
      rates.create({ governorate: 'Atlantis', fee: 5_000, freeShippingThreshold: null }),
    ).rejects.toThrow();
  });

  it('refuses a negative fee', async () => {
    await expect(
      rates.create({ governorate: 'Luxor', fee: -1, freeShippingThreshold: null }),
    ).rejects.toThrow();
  });

  it('refuses an unknown field, because the schema is strict', async () => {
    // `strict: 'throw'` — a typo in an admin editor must fail rather than write
    // a field nothing reads and everyone later believes in.
    await expect(
      rates.create({ governorate: 'Qena', fee: 5_000, discountBps: 500 } as never),
    ).rejects.toThrow();
  });
});

describe('the seeded values, read back from the database', () => {
  it('charges Cairo and Giza 5 000 pt and the other 25 10 000 pt', async () => {
    const rows = new Map((await repository.findAll()).map((row) => [row.governorate, row]));

    for (const governorate of EGYPTIAN_GOVERNORATES) {
      const expected = governorate === 'Cairo' || governorate === 'Giza' ? 5_000 : 10_000;

      expect(rows.get(governorate)?.fee).toBe(expected);
    }
  });

  it('leaves every row without a threshold of its own', async () => {
    const rows = await repository.findAll();

    expect(rows.every((row) => row.freeShippingThreshold === null)).toBe(true);
  });

  it('matches the seed definition exactly', async () => {
    // The database and the source of truth agree. If someone edits a fee in
    // admin this fails, which is correct: at that point the seed is no longer a
    // description of the table and whoever reads this should know.
    const rows = await repository.findAll();

    expect(
      rows.map((row) => ({
        governorate: row.governorate,
        fee: row.fee,
        freeShippingThreshold: row.freeShippingThreshold,
      })),
    ).toEqual([...SEED_SHIPPING_RATES].sort((a, b) => a.governorate.localeCompare(b.governorate)));
  });
});

describe('FulfilmentService, resolved from the container', () => {
  it('prices a real governorate from the real table', async () => {
    await expect(fulfilment.quote('Cairo', 100_000)).resolves.toEqual({
      fee: 5_000,
      priced: true,
    });

    await expect(fulfilment.quote('Aswan', 100_000)).resolves.toEqual({
      fee: 10_000,
      priced: true,
    });
  });

  it('raises for a governorate whose row is absent, and recovers when it returns', async () => {
    /*
     * The miss path against the real collection, proven by REMOVING a row
     * rather than by asking for a governorate that does not exist — the schema
     * enum makes the latter unrepresentable, which is the point of it.
     *
     * The row is restored in the same test rather than in `afterEach`, and its
     * original is captured first, so a failure between the two still leaves a
     * recoverable database and the restore is asserted.
     */
    const original = (await repository.findByGovernorate('Suez')) as ShippingRateLean;
    expect(original).not.toBeNull();

    await rates.deleteOne({ governorate: 'Suez' }).exec();

    try {
      await expect(fulfilment.quote('Suez', 100_000)).rejects.toMatchObject({
        code: 'SHIPPING_RATE_MISSING',
        status: 500,
      });
    } finally {
      await rates.create({
        governorate: original.governorate,
        fee: original.fee,
        freeShippingThreshold: original.freeShippingThreshold,
      });
    }

    await expect(fulfilment.quote('Suez', 100_000)).resolves.toEqual({
      fee: original.fee,
      priced: true,
    });
  });

  it('reads the CURRENT fee, not one cached at boot', async () => {
    /*
     * The reason the repository holds no cache.
     *
     * Every row is independently editable in admin (D-8, Phase 7). If the fee
     * were memoised, an edit would take effect only after a restart and two
     * instances could quote different prices for the same order — money a
     * customer is shown must not be a function of how long a process has been
     * up.
     */
    const original = (await repository.findByGovernorate('Damietta')) as ShippingRateLean;

    await rates.updateOne({ governorate: 'Damietta' }, { $set: { fee: 12_345 } }).exec();

    try {
      await expect(fulfilment.quote('Damietta', 100_000)).resolves.toEqual({
        fee: 12_345,
        priced: true,
      });
    } finally {
      await rates.updateOne({ governorate: 'Damietta' }, { $set: { fee: original.fee } }).exec();
    }

    await expect(fulfilment.quote('Damietta', 100_000)).resolves.toEqual({
      fee: original.fee,
      priced: true,
    });
  });
});

describe('the seed script is idempotent and non-destructive', () => {
  /**
   * The seed's own write, run directly. Importing the script would run its
   * `main()` and close the application out from under the suite, so the one
   * expression under test is reproduced here — and asserted against the script
   * by the shape of the update.
   */
  async function reseed(): Promise<number> {
    const result = await rates.bulkWrite(
      SEED_SHIPPING_RATES.map((rate) => ({
        updateOne: {
          filter: { governorate: rate.governorate },
          update: { $setOnInsert: rate },
          upsert: true,
        },
      })),
    );

    return result.upsertedCount;
  }

  it('adds nothing on a second run', async () => {
    expect(await reseed()).toBe(0);
    expect(await rates.countDocuments().exec()).toBe(EGYPTIAN_GOVERNORATES.length);
  });

  it('restores a missing row without touching the others', async () => {
    const original = (await repository.findByGovernorate('Matrouh')) as ShippingRateLean;
    await rates.deleteOne({ governorate: 'Matrouh' }).exec();

    expect(await reseed()).toBe(1);

    const restored = await repository.findByGovernorate('Matrouh');
    expect(restored?.fee).toBe(original.fee);
    expect(await rates.countDocuments().exec()).toBe(EGYPTIAN_GOVERNORATES.length);
  });

  it('does NOT overwrite a fee somebody edited', async () => {
    /*
     * Idempotent and non-destructive are different properties, and this is the
     * second one. Every row is independently editable, so a re-seed that reset
     * an adjusted rate back to 10 000 would be a silent pricing change — and
     * the person who ran the command would have no reason to look.
     */
    const original = (await repository.findByGovernorate('Sohag')) as ShippingRateLean;
    await rates.updateOne({ governorate: 'Sohag' }, { $set: { fee: 22_500 } }).exec();

    try {
      expect(await reseed()).toBe(0);

      expect((await repository.findByGovernorate('Sohag'))?.fee).toBe(22_500);
    } finally {
      await rates.updateOne({ governorate: 'Sohag' }, { $set: { fee: original.fee } }).exec();
    }
  });
});
