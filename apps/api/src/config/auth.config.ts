import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * Authentication configuration.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §4 —
 * `auth.config.ts # jwtSecret, accessTtl, refreshTtl, bcryptRounds`.
 *
 * No auth code reads `process.env`. The signing key arrives here already
 * validated for minimum strength, and the TTLs arrive already parsed to
 * seconds, so no service parses a duration string at request time.
 */

const SECONDS_PER_UNIT: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
};

/**
 * `15m` → 900. The shape is guaranteed by the env schema, so this cannot fail
 * at runtime; the throw exists so a future schema change cannot silently
 * produce NaN.
 */
function toSeconds(duration: string): number {
  const match = /^([1-9][0-9]*)([smhd])$/.exec(duration);
  const unit = match === null ? undefined : SECONDS_PER_UNIT[match[2] as string];

  if (match === null || unit === undefined) {
    throw new Error(`Unparseable duration: ${duration}`);
  }

  return Number(match[1]) * unit;
}

export const authConfig = registerAs('auth', () => {
  const e = env();

  return {
    jwtSecret: e.JWT_SECRET,

    /** Both forms: the string for `@nestjs/jwt`, the seconds for `expiresIn` metadata. */
    accessTtl: e.JWT_ACCESS_TTL,
    accessTtlSeconds: toSeconds(e.JWT_ACCESS_TTL),

    refreshTtl: e.JWT_REFRESH_TTL,
    refreshTtlSeconds: toSeconds(e.JWT_REFRESH_TTL),

    bcryptRounds: e.BCRYPT_ROUNDS,

    requireEmailVerification: e.AUTH_REQUIRE_EMAIL_VERIFICATION,
  } as const;
});

export type AuthConfig = ConfigType<typeof authConfig>;
