import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from '../../../common/errors/app.exception';
import { AuditService, type AuditContext } from '../../audit/application/audit.service';
import { AuditAction, AuditEntityType } from '../../audit/domain/audit-action';
import { toAuditActor } from '../../audit/domain/audit-actor';
import { User, type UserLean } from '../../users/infrastructure/schemas/user.schema';
import {
  ShippingRate,
  type ShippingRateLean,
} from '../infrastructure/schemas/shipping-rate.schema';

export interface AdminShippingRateContext {
  readonly actorId: Types.ObjectId;
  readonly forensics: AuditContext;
}

/**
 * Management of the delivery rate table.
 *
 * Authority: docs/architecture/MONEY-MODEL.md §6; PLAN.md Phase 7, D-8 second half.
 *
 * ## The D-8 invariants
 *
 * 1. **Every Egyptian governorate has an explicit rate.** The table is seeded
 *    with all 27 governorates and there is no fallback row and no sentinel.
 *    A lookup miss at checkout raises rather than guessing a fee.
 * 2. **Row deletion is refused.** An operator cannot delete a row, because
 *    removing any governorate would cause all checkout attempts for that
 *    governorate to fail with a 500 error. If free shipping is desired, the fee
 *    is set to 0.
 * 3. **Fees are non-negative integers in minor units (piastres).**
 * 4. **Every fee mutation emits an audit row.**
 */
@Injectable()
export class ShippingRatesAdminService {
  private readonly logger = new Logger(ShippingRatesAdminService.name);

  constructor(
    @InjectModel(ShippingRate.name) private readonly rates: Model<ShippingRate>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly audit: AuditService,
  ) {}

  /** Every rate in the system, sorted alphabetically by governorate. */
  async list(): Promise<ShippingRateLean[]> {
    return this.rates.find().sort({ governorate: 1 }).lean<ShippingRateLean[]>().exec();
  }

  /** Read one governorate's rate. */
  async findByGovernorate(governorate: string): Promise<ShippingRateLean> {
    const rate = await this.rates.findOne({ governorate }).lean<ShippingRateLean>().exec();

    if (rate === null) throw AppException.resourceNotFound();

    return rate;
  }

  /**
   * Updates delivery fee for one governorate and emits an audit record.
   *
   * ## Setting fee to 0 means free delivery
   *
   * 0 is valid and distinct from absence. Absence raises; 0 quotes free shipping.
   */
  async updateFee(
    governorate: string,
    fee: number,
    context: AdminShippingRateContext,
  ): Promise<ShippingRateLean> {
    const actor = await this.users.findById(context.actorId).lean<UserLean>().exec();

    if (actor === null || actor.deletedAt !== null) throw AppException.accountDisabled();

    const target = await this.rates.findOne({ governorate }).lean<ShippingRateLean>().exec();

    if (target === null) throw AppException.resourceNotFound();

    const updated = (await this.rates
      .findOneAndUpdate(
        { governorate },
        { $set: { fee } },
        { new: true },
      )
      .lean<ShippingRateLean>()
      .exec()) as ShippingRateLean;

    await this.audit.recordChange({
      actor: toAuditActor(actor),
      action: AuditAction.SHIPPING_RATE_CHANGED,
      entity: { type: AuditEntityType.SHIPPING_RATE, id: updated._id, label: governorate },
      before: { fee: target.fee },
      after: { fee: updated.fee },
      context: context.forensics,
    });

    if (target.fee !== updated.fee) {
      this.logger.warn(
        `shipping rate changed  governorate=${governorate}  ${target.fee} -> ${updated.fee}  ` +
          `by=${actor._id.toHexString()}`,
      );
    }

    return updated;
  }

  /**
   * Refuses deletion of a shipping rate row.
   *
   * D-8 ratified: All 27 governorates must remain present in the table.
   * A miss raises, so removing a row would break checkout for that entire region.
   */
  delete(): never {
    throw AppException.cannotDeleteShippingRate();
  }
}
