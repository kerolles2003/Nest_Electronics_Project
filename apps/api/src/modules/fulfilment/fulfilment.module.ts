import { Module } from '@nestjs/common';
import { FulfilmentService } from './fulfilment.service';

/**
 * Shipping cost policy.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §9; CODEBASE-STRUCTURE.md §3
 * and §7 — `fulfilment` is a **Tier 1 (flat)** module with no repository and no
 * port, and CODE-STANDARDS.md §56 fixes the British spelling.
 *
 * TWO files, not the five the Tier-1 template allows. There is no controller
 * because shipping has no HTTP surface — nothing outside the server may ask for
 * or supply a fee — no `dto/` for the same reason, and no `schemas/` because the
 * `shippingRates` collection is not created (see `fulfilment.config.ts`). The
 * template is a ceiling, not a quota.
 *
 * The frozen map also gives this module `orders.shipment`, "written on behalf of
 * Orders". It is deliberately NOT moved here: that write already exists inside
 * `OrderLifecycleService`, in the same atomic update that sets `status =
 * SHIPPED`, and splitting one atomic transition across two modules to satisfy an
 * ownership table would break the property that makes it correct.
 */
@Module({
  providers: [FulfilmentService],
  exports: [FulfilmentService],
})
export class FulfilmentModule {}
