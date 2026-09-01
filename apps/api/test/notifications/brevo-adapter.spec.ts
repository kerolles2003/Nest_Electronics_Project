import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { EmailConfig } from '../../src/config/email.config';
import {
  EmailConfigurationError,
  EmailRateLimitError,
  EmailRecipientError,
  EmailTransportError,
} from '../../src/modules/notifications/application/ports/email-errors';
import type { OutboundEmail } from '../../src/modules/notifications/application/ports/email-sender.port';
import { BrevoEmailSender } from '../../src/providers/email/brevo/brevo-email-sender';
import {
  BREVO_SEND_URL,
  toBrevoPayload,
  toDeliveryError,
  toTransportError,
} from '../../src/providers/email/brevo/brevo.mapper';

/**
 * The Brevo adapter.
 *
 * NO NETWORK. The mapper is pure, and the sender's `fetch` is replaced for
 * every test — asserted below, so the suite cannot silently start making real
 * requests if that stub is ever removed.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §5.4, §5.7 step 4
 * ("run the shared port conformance suite against the new adapter").
 */

const IDENTITY = {
  fromAddress: 'orders@nestelectronics.test',
  fromName: 'Nest Electronics',
  replyTo: 'support@nestelectronics.test',
};

const EMAIL_CONFIG = {
  provider: 'brevo',
  fromAddress: IDENTITY.fromAddress,
  fromName: IDENTITY.fromName,
  replyTo: IDENTITY.replyTo,
} as unknown as EmailConfig;

const MESSAGE: OutboundEmail = {
  to: [{ email: 'mina@example.test', name: 'Mina Kerolles' }],
  subject: 'We received your order NE-1',
  html: '<p>hello</p>',
  text: 'hello',
};

describe('payload mapping', () => {
  it('builds the sender from configuration, not from the caller', () => {
    const payload = toBrevoPayload(MESSAGE, IDENTITY);

    expect(payload.sender).toEqual({
      email: 'orders@nestelectronics.test',
      name: 'Nest Electronics',
    });
    // `OutboundEmail` has no `from` field at all — the structural reason a
    // business caller cannot send from the wrong address.
    expect(MESSAGE).not.toHaveProperty('from');
  });

  it('maps recipients to Brevo objects, not to formatted strings', () => {
    // The shape difference from Resend that this adapter exists to absorb:
    // Resend takes `"Name <addr>"`, Brevo takes `{ email, name }`. Nothing
    // above the port knows either.
    const payload = toBrevoPayload(MESSAGE, IDENTITY);

    expect(payload.to).toEqual([{ email: 'mina@example.test', name: 'Mina Kerolles' }]);
  });

  it('omits a blank display name rather than sending an empty string', () => {
    const payload = toBrevoPayload({ ...MESSAGE, to: [{ email: 'x@y.test', name: '   ' }] }, IDENTITY);

    expect(payload.to).toEqual([{ email: 'x@y.test' }]);
  });

  it('truncates a display name to the 70 characters Brevo accepts', () => {
    const long = 'A'.repeat(120);
    const payload = toBrevoPayload({ ...MESSAGE, to: [{ email: 'x@y.test', name: long }] }, IDENTITY);

    // Truncated, not rejected: losing the tail of a name is strictly better
    // than losing the order confirmation it was attached to.
    expect(payload.to[0]?.name).toHaveLength(70);
  });

  it('carries both HTML and plain text, always', () => {
    const payload = toBrevoPayload(MESSAGE, IDENTITY);

    expect(payload.htmlContent).toBe('<p>hello</p>');
    expect(payload.textContent).toBe('hello');
  });

  it('applies the configured reply-to and lets a message override it', () => {
    expect(toBrevoPayload(MESSAGE, IDENTITY).replyTo).toEqual({
      email: 'support@nestelectronics.test',
    });
    expect(toBrevoPayload({ ...MESSAGE, replyTo: 'other@z.test' }, IDENTITY).replyTo).toEqual({
      email: 'other@z.test',
    });
  });

  it('omits reply-to entirely when none is configured', () => {
    expect(toBrevoPayload(MESSAGE, { ...IDENTITY, replyTo: null })).not.toHaveProperty('replyTo');
  });

  it('flattens key/value tags into the flat string array Brevo expects', () => {
    const payload = toBrevoPayload(
      { ...MESSAGE, tags: { type: 'order_placed', orderNumber: 'NE-2026/08/31 #7' } },
      IDENTITY,
    );

    expect(payload.tags).toEqual(['type:order_placed', 'orderNumber:NE-2026_08_31__7']);
  });

  it('passes an idempotency key as a custom header', () => {
    const payload = toBrevoPayload({ ...MESSAGE, idempotencyKey: 'order-placed:abc' }, IDENTITY);

    expect(payload.headers).toEqual({ 'Idempotency-Key': 'order-placed:abc' });
  });

  it('omits headers and tags when there are none', () => {
    const payload = toBrevoPayload(MESSAGE, IDENTITY);

    expect(payload).not.toHaveProperty('headers');
    expect(payload).not.toHaveProperty('tags');
  });
});

describe('error classification', () => {
  const classify = (status: number, code?: string): unknown =>
    toDeliveryError(status, code === undefined ? { message: 'x' } : { code, message: 'x' });

  it.each([
    'unauthorized',
    'permission_denied',
    'account_under_validation',
    'api-key not found',
    'Authentication failed',
    'Domain does not exist',
    'DMARC policy requires domain authentication',
    'DNS records not properly configured',
  ])('treats %s as configuration — no retry can fix it', (code) => {
    const error = classify(400, code);

    expect(error).toBeInstanceOf(EmailConfigurationError);
    expect((error as EmailConfigurationError).retryable).toBe(false);
  });

  it.each(['invalid_parameter', 'missing_parameter', 'unprocessable_entity'])(
    'treats %s as a recipient failure, never retried',
    (code) => {
      const error = classify(400, code);

      expect(error).toBeInstanceOf(EmailRecipientError);
      expect((error as EmailRecipientError).retryable).toBe(false);
    },
  );

  it.each(['not_enough_credits', 'Insufficient credits'])(
    'treats %s as a rate limit, retryable',
    (code) => {
      const error = classify(400, code);

      expect(error).toBeInstanceOf(EmailRateLimitError);
      expect((error as EmailRateLimitError).retryable).toBe(true);
    },
  );

  /**
   * Status is consulted BEFORE the code, because Brevo's own types make `code`
   * optional — an unlabelled 429 or 503 must still be classified correctly.
   */
  it('classifies 429 as a rate limit even with no code', () => {
    expect(classify(429)).toBeInstanceOf(EmailRateLimitError);
  });

  it.each([500, 502, 503])('classifies HTTP %s as transport, retryable', (status) => {
    const error = classify(status);

    expect(error).toBeInstanceOf(EmailTransportError);
    expect((error as EmailTransportError).retryable).toBe(true);
  });

  it('classifies 401 and 403 as configuration even with no code', () => {
    expect(classify(401)).toBeInstanceOf(EmailConfigurationError);
    expect(classify(403)).toBeInstanceOf(EmailConfigurationError);
  });

  it('treats an UNRECOGNISED code as retryable transport, not a permanent verdict', () => {
    const error = classify(400, 'some_code_added_next_year');

    expect(error).toBeInstanceOf(EmailTransportError);
    expect((error as EmailTransportError).retryable).toBe(true);
  });

  it('keeps the code and status in the message for the log', () => {
    const error = toDeliveryError(422, { code: 'invalid_parameter', message: 'bad email' }) as Error;

    expect(error.message).toContain('invalid_parameter');
    expect(error.message).toContain('bad email');
    expect(error.message).toContain('422');
  });

  it('wraps a thrown socket failure as transport, preserving the cause', () => {
    const cause = new Error('ECONNRESET');
    const error = toTransportError(cause);

    expect(error).toBeInstanceOf(EmailTransportError);
    expect(error.cause).toBe(cause);
  });
});

describe('the sender, over a stubbed transport', () => {
  let fetchMock: jest.Mock;
  const realFetch = globalThis.fetch;

  function respond(status: number, body: unknown): void {
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as never);
  }

  function sender(): BrevoEmailSender {
    return new BrevoEmailSender({ apiKey: 'fake-key-never-real' }, EMAIL_CONFIG);
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // The adapter logs one line at construction; silenced so the suite output
    // stays about assertions.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('POSTs to the verified Brevo endpoint with the api-key header', async () => {
    respond(201, { messageId: '<abc@brevo>' });

    await sender().send(MESSAGE);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BREVO_SEND_URL);
    expect(init.method).toBe('POST');
    // `api-key`, not `Authorization: Bearer` — verified from the SDK's own
    // HeaderAuthProvider.
    expect((init.headers as Record<string, string>)['api-key']).toBe('fake-key-never-real');
  });

  it('returns the provider message id', async () => {
    respond(201, { messageId: '<abc@brevo>' });

    const result = await sender().send(MESSAGE);

    expect(result.providerMessageId).toBe('<abc@brevo>');
    expect(result.acceptedAt).toBeInstanceOf(Date);
  });

  it('falls back to messageIds when a batch id is returned instead', async () => {
    respond(201, { messageIds: ['<one@brevo>', '<two@brevo>'] });

    expect((await sender().send(MESSAGE)).providerMessageId).toBe('<one@brevo>');
  });

  /**
   * The vendor difference that most easily produces a silent bug: Brevo
   * signals failure with an HTTP STATUS, where Resend resolves an error
   * object. An adapter that only checked for a thrown exception would report
   * every rejection as a success.
   */
  it('throws a classified error on a non-2xx status', async () => {
    respond(401, { code: 'unauthorized', message: 'Key not found' });

    await expect(sender().send(MESSAGE)).rejects.toBeInstanceOf(EmailConfigurationError);
  });

  it('survives an error response whose body is not JSON', async () => {
    // A gateway HTML page. The 502 must be reported as transport, not as a
    // JSON parse failure that hides it.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('Unexpected token <')),
    } as never);

    await expect(sender().send(MESSAGE)).rejects.toBeInstanceOf(EmailTransportError);
  });

  it('converts a thrown network failure into a transport error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET') as never);

    await expect(sender().send(MESSAGE)).rejects.toBeInstanceOf(EmailTransportError);
  });

  it('refuses to construct without an API key', () => {
    expect(() => new BrevoEmailSender({ apiKey: '' }, EMAIL_CONFIG)).toThrow(/BREVO_API_KEY/);
  });

  it('never contacts the real network', () => {
    // The stub is the only transport. If this assertion ever fails, a test
    // above is making a genuine request and must be fixed before it bills
    // somebody's account.
    expect(globalThis.fetch).toBe(fetchMock);
    expect(fetchMock).not.toBe(realFetch);
  });
});
