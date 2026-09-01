import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../../app.module';
import { ShippingRate } from '../../modules/fulfilment/infrastructure/schemas/shipping-rate.schema';
import { SEED_SHIPPING_RATES } from './shipping.seed-data';

/**
 * Installs the 27 ratified shipping rates.
 *
 *   pnpm --filter api shipping:seed
 *
 * ## A release step, not a development fixture
 *
 * Separate from `seed` on purpose. The catalogue seed is development data that
 * must never reach production (D-6); this is the opposite — with no fallback
 * row, an empty `shippingRates` collection means every checkout in the country
 * raises. It belongs beside `indexes:sync` in a deployment, and keeping the two
 * commands apart is what lets it run where the catalogue seed must not.
 *
 * ## Idempotent AND non-destructive, which are different things
 *
 * `$setOnInsert`, never `$set`. Every row is independently editable in admin
 * (D-8), so a second run must not undo an edit — a re-seed that quietly resets
 * Alexandria from an adjusted 12 000 back to 10 000 would be a silent pricing
 * change, and the person who ran it would have no reason to look.
 *
 * The consequence is stated rather than hidden: this command **adds missing
 * rows and leaves existing ones alone**. Changing a rate is an admin action,
 * not a re-seed.
 */

const logger = new Logger('ShippingSeed');

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const rates = app.get<Model<ShippingRate>>(getModelToken(ShippingRate.name));

    const result = await rates.bulkWrite(
      SEED_SHIPPING_RATES.map((rate) => ({
        updateOne: {
          filter: { governorate: rate.governorate },
          update: { $setOnInsert: rate },
          upsert: true,
        },
      })),
    );

    const total = await rates.countDocuments().exec();

    logger.log(
      `shipping rates: ${String(result.upsertedCount)} added, ` +
        `${String(SEED_SHIPPING_RATES.length - result.upsertedCount)} already present, ` +
        `${String(total)} rows total`,
    );

    /*
     * The count is asserted, not just reported.
     *
     * A lookup miss raises, so a table of 26 is not a smaller table — it is one
     * governorate whose customers cannot check out at all, and nothing else in
     * the system will say so until one of them tries.
     */
    if (total !== SEED_SHIPPING_RATES.length) {
      logger.error(
        `expected ${String(SEED_SHIPPING_RATES.length)} rows, found ${String(total)}. ` +
          'Every governorate must be priced: a missing row raises at checkout.',
      );
      process.exitCode = 1;
      return;
    }

    for (const rate of await rates.find().sort({ governorate: 1 }).lean().exec()) {
      logger.log(`  ${rate.governorate.padEnd(14)} ${String(rate.fee).padStart(6)} pt`);
    }

    logger.log('shipping seed complete');
  } catch (error) {
    logger.error(
      `shipping seed failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
