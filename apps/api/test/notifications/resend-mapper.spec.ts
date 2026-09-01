import { describe, expect, it } from '@jest/globals';
import {
  EmailConfigurationError,
  EmailRateLimitError,
  EmailRecipientError,
  EmailTransportError,
} from '../../src/modules/notifications/application/ports/email-errors';
import type { OutboundEmail } from '../../src/modules/notifications/application/ports/email-sender.port';
import {
  toDeliveryError,
  toResendPayload,
  toTransportError,
} from '../../src/providers/email/resend/resend.mapper';

/**
 * The Resend translation layer.
 *
 * NO NETWORK, NO API KEY, NO SDK CLIENT. These are pure functions, which is
 * the point: the mapping table is where a provider adapter is most likely to
 * be wrong, and it is fully testable without ever contacting the vendor.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §5.4, §7.
 */

const IDENTITY = {
  fromAddress: 'orders@nestelectronics.test',
  fromName: 'Nest Electronics',
  replyTo: 'support@nestelectronics.test',
};

const MESSAGE: OutboundEmail = {
  to: [{ email: 'mina@example.test', name: 'Mina Kerolles' }],
  subject: 'We received your order NE-1',
  html: '<p>hello</p>',
  text: 'hello',
};

describe('payload mapping', () => {
  it('builds the from-header from configuration, not from the caller', () => {
    // `OutboundEmail` has no `from` field at all, so a business caller cannot
    // send from the wrong address even deliberately.
    const payload = toResendPayload(MESSAGE, IDENTITY);

    expect(payload.from).toBe('Nest Electronics <orders@nestelectronics.test>');
    expect(MESSAGE).not.toHaveProperty('from');
  });

  it('formats a named recipient and a bare address differently', () => {
    const named = toResendPayload(MESSAGE, IDENTITY);
    const bare = toResendPayload({ ...MESSAGE, to: [{ email: 'x@y.test' }] }, IDENTITY);

    expect(named.to).toEqual(['Mina Kerolles <mina@example.test>']);
    expect(bare.to).toEqual(['x@y.test']);
  });

  it('treats a blank display name as absent', () => {
    const payload = toResendPayload(
      { ...MESSAGE, to: [{ email: 'x@y.test', name: '   ' }] },
      IDENTITY,
    );

    expect(payload.to).toEqual(['x@y.test']);
  });

  it('applies the configured reply-to, and lets a message override it', () => {
    expect(toResendPayload(MESSAGE, IDENTITY).replyTo).toBe('support@nestelectronics.test');
    expect(toResendPayload({ ...MESSAGE, replyTo: 'other@z.test' }, IDENTITY).replyTo).toBe(
      'other@z.test',
    );
  });

  it('omits reply-to entirely when none is configured', () => {
    const payload = toResendPayload(MESSAGE, { ...IDENTITY, replyTo: null });

    expect(payload).not.toHaveProperty('replyTo');
  });

  it('always sends both HTML and plain text', () => {
    const payload = toResendPayload(MESSAGE, IDENTITY);

    expect(payload.html).toBe('<p>hello</p>');
    expect(payload.text).toBe('hello');
  });

  it('sanitises tag characters the provider would reject', () => {
    // A rejected tag must never be the reason an order confirmation fails to
    // send — tags are diagnostics, not content.
    const payload = toResendPayload(
      { ...MESSAGE, tags: { type: 'order_placed', orderNumber: 'NE-2026/08/31 #7' } },
      IDENTITY,
    );

    expect(payload.tags).toEqual([
      { name: 'type', value: 'order_placed' },
      { name: 'orderNumber', value: 'NE-2026_08_31__7' },
    ]);
  });

  it('omits tags when there are none', () => {
    expect(toResendPayload(MESSAGE, IDENTITY)).not.toHaveProperty('tags');
  });
});

describe('error classification', () => {
  const classify = (name: string, statusCode: number | null = 400): unknown =>
    toDeliveryError({ name, message: 'from the provider', statusCode });

  it.each([
    'missing_api_key',
    'invalid_api_key',
    'restricted_api_key',
    'invalid_access',
    'validation_error',
    'invalid_from_address',
    'security_error',
  ])('treats %s as a configuration failure that no retry can fix', (code) => {
    const error = classify(code);

    expect(error).toBeInstanceOf(EmailConfigurationError);
    expect((error as EmailConfigurationError).retryable).toBe(false);
  });

  it.each(['invalid_parameter', 'missing_required_field'])(
    'treats %s as a recipient failure, never retried',
    (code) => {
      const error = classify(code);

      expect(error).toBeInstanceOf(EmailRecipientError);
      expect((error as EmailRecipientError).retryable).toBe(false);
    },
  );

  it.each([
    'rate_limit_exceeded',
    'daily_quota_exceeded',
    'monthly_quota_exceeded',
    'concurrent_idempotent_requests',
  ])('treats %s as a rate limit, retryable with backoff', (code) => {
    const error = classify(code);

    expect(error).toBeInstanceOf(EmailRateLimitError);
    expect((error as EmailRateLimitError).retryable).toBe(true);
  });

  it.each(['internal_server_error', 'application_error'])(
    'treats %s as transport, retryable',
    (code) => {
      const error = classify(code);

      expect(error).toBeInstanceOf(EmailTransportError);
      expect((error as EmailTransportError).retryable).toBe(true);
    },
  );

  it('treats an UNRECOGNISED code as retryable transport, not as a permanent verdict', () => {
    // Deliberate: assuming "unknown means never retry" silently discards mail
    // the first time the vendor adds a code.
    const error = classify('some_code_added_next_year');

    expect(error).toBeInstanceOf(EmailTransportError);
    expect((error as EmailTransportError).retryable).toBe(true);
  });

  it('keeps the provider code and status in the message for the log', () => {
    const error = classify('internal_server_error', 503) as Error;

    expect(error.message).toContain('internal_server_error');
    expect(error.message).toContain('503');
  });

  it('wraps a thrown socket failure as transport, preserving the cause', () => {
    const cause = new Error('ECONNRESET');
    const error = toTransportError(cause);

    expect(error).toBeInstanceOf(EmailTransportError);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('ECONNRESET');
    expect(error.cause).toBe(cause);
  });
});

describe('no vendor type escapes', () => {
  it('returns only module-owned errors', () => {
    // Every error leaving this directory is one of four module classes, which
    // is what lets NotificationsService grade a failure without knowing which
    // vendor is installed.
    const errors = [
      toDeliveryError({ name: 'invalid_api_key', message: 'x', statusCode: 401 }),
      toDeliveryError({ name: 'rate_limit_exceeded', message: 'x', statusCode: 429 }),
      toTransportError(new Error('boom')),
    ];

    for (const error of errors) {
      expect(
        ['EmailConfigurationError', 'EmailRateLimitError', 'EmailTransportError'].includes(
          error.name,
        ),
      ).toBe(true);
    }
  });
});
