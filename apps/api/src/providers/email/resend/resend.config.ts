import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from '../../../config/env.schema';

/**
 * VENDOR configuration — read by the Resend adapter and by nothing else.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §5;
 *            docs/architecture/PROVIDER-ARCHITECTURE.md §5.5.
 *
 * This namespace is the whole reason `RESEND_API_KEY` is absent from the
 * application-level `email` namespace: a credential that only one adapter can
 * reach cannot be leaked by a service that has no way to obtain it. Adding
 * Zoho adds a `zoho.config.ts` beside this file and moves nothing.
 *
 * The key is non-null by construction, not by assertion: the env schema's
 * conditional rule makes `RESEND_API_KEY` mandatory whenever
 * `EMAIL_PROVIDER=resend`, and this namespace is only ever injected by the
 * adapter that selection chooses. The fallback below therefore cannot be
 * reached through the composition root — it exists so that a hypothetical
 * direct instantiation fails loudly at construction rather than sending
 * unauthenticated requests.
 */
export const resendConfig = registerAs('resend', () => {
  const e = env();

  return { apiKey: e.RESEND_API_KEY ?? '' } as const;
});

export type ResendConfig = ConfigType<typeof resendConfig>;
