import { afterEach, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { emailConfig, type EmailConfig } from '../../src/config/email.config';
import { mediaConfig, type MediaConfig } from '../../src/config/media.config';
import { MediaStoragePort } from '../../src/modules/media/application/ports/media-storage.port';
import { EmailSenderPort } from '../../src/modules/notifications/application/ports/email-sender.port';
import { BrevoEmailSender } from '../../src/providers/email/brevo/brevo-email-sender';
import { brevoConfig, type BrevoConfig } from '../../src/providers/email/brevo/brevo.config';
import { ConsoleEmailSender } from '../../src/providers/email/console/console-email-sender';
import { ResendEmailSender } from '../../src/providers/email/resend/resend-email-sender';
import { resendConfig, type ResendConfig } from '../../src/providers/email/resend/resend.config';
import { CloudinaryMediaStorage } from '../../src/providers/media/cloudinary/cloudinary-media-storage';
import {
  cloudinaryConfig,
  type CloudinaryConfig,
} from '../../src/providers/media/cloudinary/cloudinary.config';
import { InMemoryMediaStorage } from '../../src/providers/media/memory/in-memory-media-storage';
import { ProvidersModule } from '../../src/providers/providers.module';

/**
 * The composition switch.
 *
 * `PROVIDER-ARCHITECTURE.md` §4 makes one claim above all others: the provider
 * is replaceable by changing ONE value in ONE file. This suite is the evidence
 * for that claim — it resolves each port from the real `ProvidersModule` under
 * every setting and checks which implementation comes out.
 *
 * There are TWO switches now, email and media, and both are covered. The media
 * one was added in Phase 4 and shipped shaped exactly like the email one; a
 * second switch that behaved differently would be the first sign that the
 * pattern had become a coincidence rather than a design.
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

/**
 * Compiles the real module with every namespace supplied.
 *
 * ALL FOUR are overridden on every call, even when a test only cares about one
 * of them. `ProvidersModule` instantiates every namespace it imports, and an
 * un-overridden one reads the process environment through `env()` — which
 * throws outside a validated `ConfigModule`. Supplying them all is what lets
 * this suite compile the module in genuine isolation rather than against
 * whatever `.env` happens to say on the machine running it.
 *
 * (Adding the media switch broke this suite for exactly that reason: eight
 * tests failed with "Configuration accessed before validateEnv() ran", none of
 * them about email.)
 */
async function compileProviders(options: {
  email: EmailConfig['provider'];
  apiKey: string;
  media?: MediaConfig['provider'];
}) {
  const media: MediaConfig['provider'] = options.media ?? 'memory';

  moduleRef = await Test.createTestingModule({ imports: [ProvidersModule] })
    // Overriding the namespaces is possible only because ProvidersModule
    // imports them rather than relying on the global ConfigModule.
    .overrideProvider(emailConfig.KEY)
    .useValue({
      provider: options.email,
      fromAddress: 'orders@nestelectronics.test',
      fromName: 'Nest Electronics',
      replyTo: null,
    } satisfies EmailConfig)
    // BOTH vendor keys are supplied for every case. Only the selected adapter
    // is constructed, so the other value is never read — which is itself part
    // of what these tests assert.
    .overrideProvider(resendConfig.KEY)
    .useValue({ apiKey: options.apiKey } satisfies ResendConfig)
    .overrideProvider(brevoConfig.KEY)
    .useValue({ apiKey: options.apiKey } satisfies BrevoConfig)
    .overrideProvider(mediaConfig.KEY)
    .useValue({
      provider: media,
      maxBytes: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      minEdge: 200,
      maxEdge: 4000,
      maxImagesPerProduct: 8,
      folderRoot: 'nest',
    } as MediaConfig)
    .overrideProvider(cloudinaryConfig.KEY)
    .useValue({
      cloudName: 'fake-cloud-never-called',
      apiKey: 'fake',
      apiSecret: 'fake',
    } satisfies CloudinaryConfig)
    .compile();

  return moduleRef;
}

async function resolvePort(
  provider: EmailConfig['provider'],
  apiKey: string,
): Promise<EmailSenderPort> {
  const compiled = await compileProviders({ email: provider, apiKey });

  return compiled.get<EmailSenderPort>(EmailSenderPort);
}

async function resolveMediaPort(provider: MediaConfig['provider']): Promise<MediaStoragePort> {
  const compiled = await compileProviders({ email: 'console', apiKey: '', media: provider });

  return compiled.get<MediaStoragePort>(MediaStoragePort);
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

describe('MEDIA_PROVIDER selects the implementation', () => {
  /**
   * The second switch, asserted the same way as the first.
   *
   * Constructing the Cloudinary adapter calls `cloudinary.config(...)`, which
   * stores credentials in the SDK and makes no request. Nothing here calls
   * `upload`, `destroy` or `list`, so no byte reaches a media account under any
   * setting — the same property the email cases rely on.
   */
  it("binds the in-memory store when the value is 'memory'", async () => {
    const storage = await resolveMediaPort('memory');

    expect(storage).toBeInstanceOf(InMemoryMediaStorage);
    expect(storage).toBeInstanceOf(MediaStoragePort);
  });

  it("binds the Cloudinary store when the value is 'cloudinary'", async () => {
    const storage = await resolveMediaPort('cloudinary');

    expect(storage).toBeInstanceOf(CloudinaryMediaStorage);
    expect(storage).toBeInstanceOf(MediaStoragePort);
  });

  it('constructs no vendor client at all when memory is selected', async () => {
    // The reason every developer machine today — none of which has a
    // Cloudinary account — holds no Cloudinary client and reads no credential.
    const storage = await resolveMediaPort('memory');

    expect(storage).not.toBeInstanceOf(CloudinaryMediaStorage);
  });

  it('exports both under the same token, satisfying the same contract', async () => {
    const memory = await resolveMediaPort('memory');
    expect([typeof memory.upload, typeof memory.destroy, typeof memory.list]).toEqual([
      'function',
      'function',
      'function',
    ]);
    await moduleRef?.close();
    moduleRef = null;

    const cloudinary = await resolveMediaPort('cloudinary');
    expect([typeof cloudinary.upload, typeof cloudinary.destroy, typeof cloudinary.list]).toEqual([
      'function',
      'function',
      'function',
    ]);
  });

  it('chooses the two ports INDEPENDENTLY', async () => {
    // A single `provider` value driving both would be the obvious wrong
    // shortcut, and it would tie a mail vendor change to a CDN change.
    const compiled = await compileProviders({
      email: 'brevo',
      apiKey: 'fake-key-never-used',
      media: 'memory',
    });

    expect(compiled.get<EmailSenderPort>(EmailSenderPort)).toBeInstanceOf(BrevoEmailSender);
    expect(compiled.get<MediaStoragePort>(MediaStoragePort)).toBeInstanceOf(InMemoryMediaStorage);
  });
});
