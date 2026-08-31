import { ApiProperty } from '@nestjs/swagger';

/** The only currency in the system. No conversion exists. */
export const DEFAULT_CURRENCY = 'EGP';

/**
 * Formats integer minor units without ever producing a float.
 *
 * MONEY-MODEL.md §7.5 forbids any float intermediate in a money value, so this
 * splits the integer rather than dividing by 100. Locale is `en-EG`: grouped
 * thousands, always two decimals.
 */
function formatMinorUnits(amount: number, currency: string): string {
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  const major = Math.trunc(absolute / 100);
  const minor = absolute % 100;

  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${sign}${grouped}.${String(minor).padStart(2, '0')} ${currency}`;
}

/**
 * The wire format for every monetary value.
 *
 * Authority: docs/architecture/MONEY-MODEL.md §8; docs/architecture/API-CONTRACT.md §1.
 *
 * `amount` is authoritative; `formatted` is presentation only and must never be
 * parsed by a client. No response anywhere returns a bare number for money —
 * that is what makes it impossible for a client to misread the scale.
 */
export class MoneyDto {
  @ApiProperty({
    example: 32500,
    description: 'Authoritative value in integer minor units (piastres). 32500 = 325.00 EGP.',
  })
  amount!: number;

  @ApiProperty({ example: DEFAULT_CURRENCY, enum: [DEFAULT_CURRENCY] })
  currency!: string;

  @ApiProperty({
    example: '325.00 EGP',
    description: 'Server-rendered for direct display. Never parse this — use `amount`.',
  })
  formatted!: string;

  static of(amount: number, currency: string = DEFAULT_CURRENCY): MoneyDto {
    return { amount, currency, formatted: formatMinorUnits(amount, currency) };
  }
}
