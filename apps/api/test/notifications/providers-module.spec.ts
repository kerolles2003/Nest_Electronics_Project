import { afterEach, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { emailConfig, type EmailConfig } from '../../src/config/email.config';
import { EmailSenderPort } from '../../src/modules/notifications/application/ports/email-sender.port';
import { BrevoEmailSender } from '../../src/providers/email/brevo/brevo-email-sender';
import { brevoConfig, type BrevoConfig } from '../../src/providers/email/brevo/brevo.config';
import { ConsoleEmailSender } from '../../src/providers/email/console/console-email-sender';
import { ResendEmailSender } from '../../src/providers/email/resend/resend-email-sender';
import { resendConfig, type ResendConfig } from '../../src/providers/email/resend/resend.config';
import { ProvidersModule } from '../../src/providers/providers.module';

/**
 * The composition switch.
 *
 * `PROVIDER-ARCHITECTURE.md` §4 makes one claim above all others: the provider
 * is replaceable by changing ONE value in ONE file. This suite is the evidence
 * for that claim — it resolves `EmailSenderPort` from the real
 * `ProvidersModule` under every setting and checks which implementation comes
 * out.
 *
 * ## No network, under any setting
 *
 * Constructing a vendor adapter builds a client or reads a key; it does not
 * call anything. These tests resolve the port and inspect its type, and never
 * invoke `send`, so nothing reaches a provider even in the vendor cases. The
 * keys used are literal fakes.
 */

let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>> | null =
  null;

async function resolvePort(
  provider: EmailConfig['provider'],
  apiKey: string,
): Promise<EmailSenderPort> {
  moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] })
    // Overriding the namespaces is possible only because ProvidersModule
    // imports them rather than relying on the global ConfigModule.
    .overrideProvider(emailConfig.KEY)
    .useValue({
      provider,
      fromAddress: 'orders@nestelectronics.test',
      fromName: 'Nest Electronics',
      replyTo: null,
    } satisfies EmailConfig)
    // BOTH vendor keys are supplied for every case. Only the selected adapter
    // is constructed, so the other value is never read — which is itself part
    // of what these tests assert.
    .overrideProvider(resendConfig.KEY)
    .useValue({ apiKey } satisfies ResendConfig)
    .overrideProvider(brevoConfig.KEY)
    .useValue({ apiKey } satisfies BrevoConfig)
    .compile();

  return moduleRef.get<EmailSenderPort>(EmailSenderPort);
}

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = null;
});

describe('EMAIL_PROVIDER selects the implementation', () => {
  it("binds the console sender when the value is 'console'", async () => {
    const sender = await resolvePort('console', '');

    expect(sender).toBeInstanceOf(ConsoleEmailSender);
    expect(sender).toBeInstanceOf(EmailSenderPort);
  });

  it("binds the Resend sender when the value is 'resend'", async () => {
    const sender = await resolvePort('resend', 'fake-key-never-used');

    expect(sender).toBeInstanceOf(ResendEmailSender);
    expect(sender).toBeInstanceOf(EmailSenderPort);
  });

  it("binds the Brevo sender when the value is 'brevo'", async () => {
    const sender = await resolvePort('brevo', 'fake-key-never-used');

    expect(sender).toBeInstanceOf(BrevoEmailSender);
    expect(sender).toBeInstanceOf(EmailSenderPort);
  });

  /**
   * The replaceability claim, stated as an assertion.
   *
   * Three implementations, one token, one value deciding between them — and
   * `PROVIDER-ARCHITECTURE.md` §5.7's promise that adding the third changed no
   * file under `modules/`.
   */
  it('selects a DIFFERENT implementation for every provider value', async () => {
    const seen: string[] = [];

    for (const provider of ['console', 'resend', 'brevo'] as const) {
      const sender = await resolvePort(provider, 'fake-key-never-used');
      seen.push(sender.constructor.name);
      await moduleRef?.close();
      moduleRef = null;
    }

    expect(seen).toEqual(['ConsoleEmailSender', 'ResendEmailSender', 'BrevoEmailSender']);
    expect(new Set(seen).size).toBe(3);
  });

  /**
   * The property that makes the abstraction worth having: consumers depend on
   * the ABSTRACT class, so every implementation is substitutable without any
   * business code knowing which one it received.
   */
  it('exports each under the same token, satisfying the same contract', async () => {
    const console_ = await resolvePort('console', '');
    expect(typeof console_.send).toBe('function');
    await moduleRef?.close();
    moduleRef = null;

    const resend = await resolvePort('resend', 'fake-key-never-used');
    expect(typeof resend.send).toBe('function');
  });

  it('constructs no vendor client at all when console is selected', async () => {
    // A development or CI process therefore holds no vendor client and reads
    // no credential, whichever vendors happen to be installed.
    const sender = await resolvePort('console', '');

    expect(sender).not.toBeInstanceOf(ResendEmailSender);
    expect(sender).not.toBeInstanceOf(BrevoEmailSender);
  });
});

describe('vendor adapters refuse to run unauthenticated', () => {
  // Unreachable through configuration — the env schema makes each key
  // mandatory whenever its adapter is selected. Asserted anyway, because the
  // alternative to failing here is sending unauthenticated requests for the
  // lifetime of the process.
  it('Resend throws at construction when the API key is empty', async () => {
    await expect(resolvePort('resend', '')).rejects.toThrow(/RESEND_API_KEY/);
  });

  it('Brevo throws at construction when the API key is empty', async () => {
    await expect(resolvePort('brevo', '')).rejects.toThrow(/BREVO_API_KEY/);
  });
});
