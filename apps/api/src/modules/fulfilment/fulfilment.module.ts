import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FulfilmentService } from './fulfilment.service';
import { ShippingRateRepository } from './infrastructure/repositories/shipping-rate.repository';
import {
  ShippingRate,
  ShippingRateSchema,
} from './infrastructure/schemas/shipping-rate.schema';

/**
 * Shipping cost policy.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §9 — "Owned collections:
 * `shippingRates`"; CODEBASE-STRUCTURE.md §3 and §7; CODE-STANDARDS.md §56
 * fixes the British spelling.
 *
 * The module owned `shippingRates` on paper from the beginning and did not
 * create it, because OPEN-001 recorded the rates as unsupplied business input
 * and a table with nothing in it would have let a MISS decide what every
 * customer was charged. D-8 supplied them: 27 rows, one per governorate, no
 * default row and no fallback. The collection exists now, and the miss path
 * raises instead of guessing.
 *
 * Still no controller and no `dto/`: shipping has no HTTP surface. Nothing
 * outside the server may ask for or supply a fee, and the fee reaches a customer
 * only through the checkout quote.
 *
 * The frozen map also gives this module `orders.shipment`, "written on behalf of
 * Orders". It is deliberately NOT moved here: that write already exists inside
 * `OrderLifecycleService`, in the same atomic update that sets `status =
 * SHIPPED`, and splitting one atomic transition across two modules to satisfy an
 * ownership table would break the property that makes it correct.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: ShippingRate.name, schema: ShippingRateSchema }]),
  ],
  providers: [FulfilmentService, ShippingRateRepository],
  exports: [FulfilmentService],
})
export class FulfilmentModule {}
