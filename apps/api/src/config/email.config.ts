import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * APPLICATION-level email configuration — provider-agnostic by construction.
 *
 * `provider` selects an implementation and is read in exactly one future
 * place: ProvidersModule, to choose a `useClass`. No business code may ever
 * branch on it; `if (config.email.provider === 'resend')` inside a service is
 * the provider leakage this boundary exists to prevent.
 *
 * VENDOR credentials are deliberately ABSENT from this namespace.
 * `RESEND_API_KEY` is validated by the env schema but exposed only through the
 * Resend adapter's own vendor config, which does not exist yet — so nothing
 * can read it today.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §5;
 *            docs/architecture/PROVIDER-ARCHITECTURE.md §5.5.
 */
export const emailConfig = registerAs('email', () => {
  const e = env();

  return { provider: e.EMAIL_PROVIDER } as const;
});

export type EmailConfig = ConfigType<typeof emailConfig>;
