import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { User, UserSchema } from '../users/infrastructure/schemas/user.schema';
import { ShippingRatesAdminService } from './application/shipping-rates-admin.service';
import { FulfilmentService } from './fulfilment.service';
import { ShippingRateRepository } from './infrastructure/repositories/shipping-rate.repository';
import {
  ShippingRate,
  ShippingRateSchema,
} from './infrastructure/schemas/shipping-rate.schema';
import { AdminShippingRatesController } from './presentation/admin-shipping-rates.controller';

/**
 * Shipping cost policy and admin management.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §9 — "Owned collections:
 * `shippingRates`"; CODEBASE-STRUCTURE.md §3 and §7; CODE-STANDARDS.md §56
 * fixes the British spelling.
 *
 * D-8 supplied the rate table: 27 rows, one per governorate, no default row and
 * no fallback. Phase 7 completes the capability by exposing the staff management
 * API (`/admin/shipping-rates`) with audit logging and deletion refusal.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShippingRate.name, schema: ShippingRateSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuditModule,
  ],
  controllers: [AdminShippingRatesController],
  providers: [FulfilmentService, ShippingRateRepository, ShippingRatesAdminService],
  exports: [FulfilmentService, ShippingRatesAdminService],
})
export class FulfilmentModule {}
