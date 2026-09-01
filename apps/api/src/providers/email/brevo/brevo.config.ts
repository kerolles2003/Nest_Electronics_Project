import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from '../../../config/env.schema';

/**
 * VENDOR configuration — read by the Brevo adapter and by nothing else.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §5;
 *            docs/architecture/PROVIDER-ARCHITECTURE.md §5.5, §5.7.
 *
 * Sits beside `resend.config.ts` rather than replacing it: §5.7's replacement
 * procedure is add → verify → switch → remove, and the two adapters coexist
 * until Brevo is proven in production. Neither namespace can see the other's
 * credential.
 *
 * The key is non-null by construction, not by assertion: the env schema makes
 * `BREVO_API_KEY` mandatory whenever `EMAIL_PROVIDER=brevo`, and this namespace
 * is only injected by the adapter that selection chooses. The fallback exists
 * so a direct instantiation fails loudly at construction rather than sending
 * unauthenticated requests.
 */
export const brevoConfig = registerAs('brevo', () => {
  const e = env();

  return { apiKey: e.BREVO_API_KEY ?? '' } as const;
});

export type BrevoConfig = ConfigType<typeof brevoConfig>;
