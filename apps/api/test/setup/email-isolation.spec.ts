import { afterEach, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '../../src/config/config.module';
import { EmailSenderPort } from '../../src/modules/notifications/application/ports/email-sender.port';
import { BrevoEmailSender } from '../../src/providers/email/brevo/brevo-email-sender';
import { ConsoleEmailSender } from '../../src/providers/email/console/console-email-sender';
import { ResendEmailSender } from '../../src/providers/email/resend/resend-email-sender';
import { ProvidersModule } from '../../src/providers/providers.module';
import { BLOCKED_EMAIL_VENDOR_HOSTS } from './email-isolation';

/**
 * The bootstrap assertion for F-07.
 *
 * Every other suite in this repository is protected by `email-isolation.ts`,
 * which is invisible at the call site — nothing in `auth-flow.spec.ts` says
 * "and no mail is sent". This suite is where that claim is made explicitly, so
 * deleting or breaking the guard fails a test that names the problem instead
 * of silently re-enabling live delivery.
 *
 * It resolves the port from the REAL `ProvidersModule` against the REAL
 * environment — not an overridden one — because the thing under test is
 * precisely what the developer's environment produces during a test run.
 */

let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>> | null =
  null;

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = null;
});

describe('F-07 — the test suite is isolated from every email vendor', () => {
  it('forces EMAIL_PROVIDER=console regardless of the developer .env', () => {
    expect(process.env.EMAIL_PROVIDER).toBe('console');
  });

  /**
   * Isolation is asserted where it actually holds.
   *
   * A developer's `.env` may legitimately carry a real vendor key, and
   * `ConfigModule` loads that file at import time — so "the key is absent" is
   * not a property this suite can honestly claim. What it can claim, and does
   * below, is that the key is never *reachable*: no vendor adapter is built,
   * and the transport to every vendor host is blocked.
   */

  it('binds EmailSenderPort to the console sender in a real module graph', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ProvidersModule],
    }).compile();

    const sender = moduleRef.get<EmailSenderPort>(EmailSenderPort);

    expect(sender).toBeInstanceOf(ConsoleEmailSender);
    expect(sender).toBeInstanceOf(EmailSenderPort);
  });

  it('constructs no vendor adapter', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ProvidersModule],
    }).compile();

    const sender = moduleRef.get<EmailSenderPort>(EmailSenderPort);

    expect(sender).not.toBeInstanceOf(BrevoEmailSender);
    expect(sender).not.toBeInstanceOf(ResendEmailSender);
  });

  it('sends through the console sender without touching the network', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ProvidersModule],
    }).compile();

    const sender = moduleRef.get<EmailSenderPort>(EmailSenderPort);

    const result = await sender.send({
      to: [{ email: 'nobody@example.test', name: 'Nobody' }],
      subject: 'isolation probe',
      html: '<p>probe</p>',
      text: 'probe',
    });

    // Proof of acceptance by the console sink, not by a provider.
    expect(result.providerMessageId).toEqual(expect.any(String));
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  describe('the transport guard', () => {
    it.each(BLOCKED_EMAIL_VENDOR_HOSTS)('throws rather than calling %s', (host) => {
      expect(() => fetch(`https://${host}/v3/smtp/email`)).toThrow(/F-07 guard/);
    });

    it('leaves non-vendor requests alone', () => {
      // Not awaited and not asserted on the response: the point is only that
      // the guard does not throw synchronously for an unrelated host.
      expect(() => {
        void fetch('http://127.0.0.1:1/nothing-here').catch(() => undefined);
      }).not.toThrow();
    });
  });
});
