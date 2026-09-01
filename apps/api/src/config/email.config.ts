import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * APPLICATION-level email configuration — provider-agnostic by construction.
 *
 * `provider` selects an implementation and is read in exactly one place:
 * `ProvidersModule`, to choose a `useClass`. No business code may ever branch
 * on it; `if (config.email.provider === 'resend')` inside a service is the
 * provider leakage this boundary exists to prevent.
 *
 * The identity fields are here rather than in the adapter's own namespace on
 * purpose. They are *business* facts — who the shop appears to be — and they
 * do not change when the transport changes. `from` is nonetheless absent from
 * `OutboundEmail` (PROVIDER-ARCHITECTURE.md §5.2): the adapter reads it from
 * here, so no caller can send from the wrong address even by mistake.
 *
 * VENDOR credentials remain deliberately ABSENT. `RESEND_API_KEY` is validated
 * by the env schema and exposed only through `resend.config.ts`, which only
 * the Resend adapter injects.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §5;
 *            docs/architecture/PROVIDER-ARCHITECTURE.md §5.5.
 */
export const emailConfig = registerAs('email', () => {
  const e = env();

  return {
    provider: e.EMAIL_PROVIDER,
    fromAddress: e.EMAIL_FROM_ADDRESS,
    fromName: e.EMAIL_FROM_NAME,
    replyTo: e.EMAIL_REPLY_TO ?? null,
  } as const;
});

export type EmailConfig = ConfigType<typeof emailConfig>;
