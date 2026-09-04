import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Min } from 'class-validator';
import {
  EGYPTIAN_GOVERNORATES,
  GOVERNORATE_VALUES,
  type EgyptianGovernorate,
} from '../../../../common/constants/governorates';
import type { ShippingRateLean } from '../../infrastructure/schemas/shipping-rate.schema';

export class ShippingRateGovernorateParamDto {
  @ApiProperty({
    description: 'Egyptian governorate name (must be one of the 27 official governorates)',
    enum: EGYPTIAN_GOVERNORATES,
    example: 'Cairo',
  })
  @IsIn(GOVERNORATE_VALUES)
  governorate!: EgyptianGovernorate;
}

export class UpdateShippingRateDto {
  @ApiProperty({
    description:
      'Delivery fee in integer minor units (piastres). 0 is permitted and represents free shipping. ' +
      'Negative values are rejected.',
    minimum: 0,
    example: 5000,
  })
  @IsInt()
  @Min(0)
  fee!: number;
}

export class AdminShippingRateDto {
  @ApiProperty({
    description: 'Governorate name',
    enum: EGYPTIAN_GOVERNORATES,
    example: 'Cairo',
  })
  governorate!: string;

  @ApiProperty({
    description: 'Fee in integer minor units (piastres). 5000 = 50.00 EGP.',
    example: 5000,
  })
  fee!: number;

  @ApiProperty({
    description: 'Human-readable formatted fee string',
    example: '50.00 EGP',
  })
  formattedFee!: string;

  @ApiProperty({
    description: 'Timestamp when this rate was last updated',
  })
  updatedAt!: Date;

  static from(rate: ShippingRateLean): AdminShippingRateDto {
    return {
      governorate: rate.governorate,
      fee: rate.fee,
      formattedFee: `${(rate.fee / 100).toFixed(2)} EGP`,
      updatedAt: rate.updatedAt,
    };
  }
}

export class AdminShippingRateListResponseDto {
  @ApiProperty({ type: [AdminShippingRateDto] })
  data!: AdminShippingRateDto[];
}

export class AdminShippingRateResponseDto {
  @ApiProperty({ type: AdminShippingRateDto })
  data!: AdminShippingRateDto;
}
