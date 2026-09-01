import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotificationsService } from '../../src/modules/notifications/application/notifications.service';
import {
  EmailConfigurationError,
  EmailRateLimitError,
  EmailRecipientError,
  EmailTransportError,
} from '../../src/modules/notifications/application/ports/email-errors';
import {
  EmailSenderPort,
  type EmailSendResult,
  type OutboundEmail,
} from '../../src/modules/notifications/application/ports/email-sender.port';
import { TemplateRendererPort } from '../../src/modules/notifications/application/ports/template-renderer.port';
import { HandlebarsTemplateRenderer } from '../../src/modules/notifications/infrastructure/handlebars-template.renderer';
import type { PlacedOrder } from '../../src/modules/orders/application/checkout.service';
import type { AppConfig } from '../../src/config/app.config';

/**
 * `NotificationsService`, against a FAKE transport and the REAL renderer.
 *
 * No database, no network, no provider credential.
 *
 * ## Why the real renderer
 *
 * Stubbing it would make these tests pass while the actual emails were broken:
 * the interesting failure — a data-contract field the template needs and the
 * mapping does not supply — only exists where real templates meet real
 * mapping. So the transport is faked (it is the thing with a bill attached)
 * and everything else is real.
 *
 * ## Why this is not "assert a method was called"
 *
 * Every test below asserts on the CONTENT that reached the transport, or on
 * the observable consequence of a failure. A test that only checked
 * `expect(sender.send).toHaveBeenCalled()` would pass against a service that
 * mailed an empty body to the wrong person.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §7;
 *            docs/architecture/TEMPLATE-ARCHITECTURE.md §9.
 */

/**
 * The replaceability proof, and the reason `EmailSenderPort` is an abstract
 * class rather than an interface: this substitutes for the real adapter with
 * no change to any business code.
 */
class FakeEmailSender extends EmailSenderPort {
  readonly sent: OutboundEmail[] = [];
  private failure: Error | null = null;

  failWith(error: Error): void {
    this.failure = error;
  }

  send(message: OutboundEmail): Promise<EmailSendResult> {
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }

    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `fake-${String(this.sent.length)}`, acceptedAt: new Date() });
  }
}

const APP_CONFIG = {
  nodeEnv: 'test',
  port: 3002,
  apiPrefix: 'api',
  swaggerEnabled: false,
  siteUrl: 'https://shop.example.test',
  corsOrigins: [],
} as unknown as AppConfig;

function orderFixture(overrides: Partial<PlacedOrder> = {}): PlacedOrder {
  return {
    _id: new Types.ObjectId('68b000000000000000000001'),
    orderNumber: 'NE-20260831-0007',
    userId: new Types.ObjectId('68b000000000000000000002'),
    status: 'PLACED',
    customer: { fullName: 'Mina Kerolles', email: 'mina@example.test', phone: '01012345678' },
    items: [
      {
        productId: new Types.ObjectId('68b000000000000000000003'),
        sku: 'ESP32-DEVKIT-V1',
        slug: 'esp32-devkit-v1',
        name: { en: 'ESP32 DevKit V1' },
        brandName: 'Espressif',
        imagePublicId: null,
        unitPrice: 32500,
        quantity: 2,
        lineTotal: 65000,
      },
    ],
    currency: 'EGP',
    pricing: {
      itemsSubtotal: 65000,
      discountTotal: 0,
      shippingFee: 0,
      // The deployed default: a zero that is NOT a price. The fixture states it
      // rather than leaving it undefined, because the whole point of the field
      // is that this case is declared instead of inferred.
      shippingPriced: false,
      grandTotal: 65000,
      vatInclusive: true,
      vatRateBps: 1400,
    },
    payment: {
      method: 'COD',
      status: 'PENDING',
      collectedAt: null,
      refundedAmount: null,
      refundNote: null,
    },
    shippingAddress: {
      fullName: 'Mina Kerolles',
      phone: '01012345678',
      street: '12 Sherif Street, Apartment 4',
      city: 'Downtown',
      governorate: 'Cairo',
      postalCode: null,
    },
    placedAt: new Date('2026-08-31T09:15:00.000Z'),
    customerNote: null,
    adminNote: null,
    idempotencyKey: 'idem-key-1',
    statusHistory: [],
    coupon: null,
    shipment: null,
    cancellation: null,
    ...overrides,
  } as unknown as PlacedOrder;
}

let sender: FakeEmailSender;
let renderer: TemplateRendererPort;
let service: NotificationsService;
let warn: ReturnType<typeof jest.spyOn>;
let error: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  sender = new FakeEmailSender();

  const real = new HandlebarsTemplateRenderer();
  real.onModuleInit();
  renderer = real;

  service = new NotificationsService(renderer, sender, APP_CONFIG);

  // Silenced AND observed: the failure policy is defined in terms of log
  // level, so the level is the assertion, not noise to be suppressed.
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  // `jest.spyOn` returns the EXISTING mock when a method is already spied, so
  // without this the call counts accumulate across cases and every
  // `toHaveBeenCalledTimes(1)` after the first would fail for the wrong
  // reason.
  jest.restoreAllMocks();
});

describe('the port is replaceable', () => {
  it('drives a fake implementation with no change to business code', async () => {
    // The entire point of the abstraction: `NotificationsService` was given a
    // class that has never heard of Resend, and behaved identically.
    await service.sendOrderConfirmation(orderFixture());

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.subject).toBe('We received your order NE-20260831-0007');
  });
});

describe('email verification', () => {
  it('sends a link built from SITE_URL carrying the raw token', async () => {
    await service.sendEmailVerification({
      recipientEmail: 'mina@example.test',
      recipientName: 'Mina Kerolles',
      rawToken: 'tok-abc-123',
    });

    const [message] = sender.sent;
    expect(message?.to).toEqual([{ email: 'mina@example.test', name: 'Mina Kerolles' }]);
    expect(message?.text).toContain('https://shop.example.test/shop/verify-email?token=tok-abc-123');
    expect(message?.tags).toEqual({ type: 'email_verification' });
  });

  it('URL-encodes a token containing URL-significant characters', async () => {
    // base64url never produces these, but the encoding is what guarantees that
    // — not the alphabet happening to be safe today.
    await service.sendEmailVerification({
      recipientEmail: 'a@b.test',
      recipientName: 'A',
      rawToken: 'a+b/c=d&e',
    });

    expect(sender.sent[0]?.text).toContain('token=a%2Bb%2Fc%3Dd%26e');
  });

  it('carries NO idempotency key, so a deliberate resend is not swallowed', async () => {
    await service.sendEmailVerification({
      recipientEmail: 'a@b.test',
      recipientName: 'A',
      rawToken: 't1',
    });

    expect(sender.sent[0]?.idempotencyKey).toBeUndefined();
  });
});

describe('order confirmation content', () => {
  it('formats money through MoneyDto rather than computing it', async () => {
    await service.sendOrderConfirmation(orderFixture());

    const [message] = sender.sent;
    // 65000 minor units → "650.00 EGP". A template cannot produce this.
    expect(message?.text).toContain('650.00 EGP');
  });

  it('addresses the mail to the ORDER snapshot, not to a live profile', async () => {
    await service.sendOrderConfirmation(
      orderFixture({
        customer: { fullName: 'Snapshot Name', email: 'snapshot@example.test', phone: null },
      } as Partial<PlacedOrder>),
    );

    expect(sender.sent[0]?.to).toEqual([
      { email: 'snapshot@example.test', name: 'Snapshot Name' },
    ]);
  });

  /**
   * The one line a customer reads for delivery, isolated from the rest of the
   * body so an assertion cannot accidentally match a different figure.
   */
  const deliveryLineOf = (text: string | undefined): string =>
    (text ?? '')
      .split('\n')
      .map((line) => line.trimEnd())
      .find((line) => line.startsWith('Delivery')) ?? '<no delivery line>';

  /**
   * The 2c correctness fix, asserted where a customer would see it.
   *
   * The email used to derive "delivery not priced" from `shippingFee === 0`.
   * These two cases have the SAME zero fee and must read differently, which is
   * precisely what the old test could not express — and what a client
   * integrating against the frozen contract would otherwise get wrong.
   */
  describe('the delivery line reports whether the fee is a price', () => {
    it('says the fee was not calculated when no rate was supplied', async () => {
      await service.sendOrderConfirmation(
        orderFixture({
          pricing: {
            itemsSubtotal: 65000,
            discountTotal: 0,
            shippingFee: 0,
            shippingPriced: false,
            grandTotal: 65000,
            vatInclusive: true,
            vatRateBps: 1400,
          },
        } as Partial<PlacedOrder>),
      );

      expect(deliveryLineOf(sender.sent[0]?.text)).toBe('Delivery          Calculated before dispatch');
    });

    it('says Free for a genuinely free delivery, despite the identical zero', async () => {
      await service.sendOrderConfirmation(
        orderFixture({
          pricing: {
            itemsSubtotal: 65000,
            discountTotal: 0,
            // Same amount as the case above. Only `shippingPriced` differs.
            shippingFee: 0,
            shippingPriced: true,
            grandTotal: 65000,
            vatInclusive: true,
            vatRateBps: 1400,
          },
        } as Partial<PlacedOrder>),
      );

      /*
       * Asserted on the DELIVERY LINE, not on the whole body.
       *
       * The previous assertion here was `toContain('0.00 EGP')` against the
       * entire text, and it was VACUOUS: the grand total renders as
       * "650.00 EGP", which contains "0.00 EGP" as a substring. It passed no
       * matter what the delivery line said — including when the line was
       * wrong. Matching the line itself is the only way this test can fail for
       * the reason it claims to.
       */
      expect(deliveryLineOf(sender.sent[0]?.text)).toBe('Delivery          Free');
    });
  });

  it('keys idempotency on the order id', async () => {
    await service.sendOrderConfirmation(orderFixture());

    expect(sender.sent[0]?.idempotencyKey).toBe('order-placed:68b000000000000000000001');
  });

  it('links to the storefront order page', async () => {
    await service.sendOrderConfirmation(orderFixture());

    expect(sender.sent[0]?.text).toContain(
      'https://shop.example.test/shop/orders/68b000000000000000000001',
    );
  });

  it('leaks no internal field into the message', async () => {
    await service.sendOrderConfirmation(orderFixture());

    const [message] = sender.sent;
    const body = `${message?.html ?? ''}${message?.text ?? ''}`;

    // The mapping names every field it copies, which is what makes this
    // assertion hold for fields added to the entity in future.
    expect(body).not.toContain('idem-key-1');
    expect(body).not.toContain('68b000000000000000000002'); // userId
    expect(body).not.toContain('ESP32-DEVKIT-V1'); // sku
    expect(body).not.toContain('vatRateBps');
  });

  it('sends both an HTML and a plain-text alternative, always', async () => {
    await service.sendOrderConfirmation(orderFixture());

    const [message] = sender.sent;
    expect(message?.html).toContain('<!doctype html>');
    expect(message?.text.length ?? 0).toBeGreaterThan(0);
    expect(message?.text).not.toContain('<table');
  });
});

describe('failure policy (never throws)', () => {
  /**
   * The load-bearing guarantee. `CheckoutService` calls this AFTER the order
   * has committed; if it could throw, a provider outage would turn a
   * successful order into a 500 for the customer who placed it.
   */
  it.each([
    ['transport', new EmailTransportError('socket hang up'), 'warn'],
    ['rate limit', new EmailRateLimitError('too many requests'), 'warn'],
    ['recipient', new EmailRecipientError('invalid address'), 'error'],
    ['configuration', new EmailConfigurationError('invalid_api_key'), 'error'],
  ])('swallows a %s failure and logs it at %s', async (_label, failure, level) => {
    sender.failWith(failure);

    await expect(service.sendOrderConfirmation(orderFixture())).resolves.toBeUndefined();

    // Retryable is weather (warn); non-retryable is a defect or a
    // misconfiguration a human must fix (error).
    const spy = level === 'warn' ? warn : error;
    const other = level === 'warn' ? error : warn;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain('email NOT sent');
  });

  it('records whether a failure is retryable', async () => {
    sender.failWith(new EmailTransportError('socket hang up'));

    await service.sendOrderConfirmation(orderFixture());

    expect(String(warn.mock.calls[0]?.[0])).toContain('retryable=true');
  });

  it('swallows a verification failure too, leaving resend as the recovery path', async () => {
    sender.failWith(new EmailTransportError('down'));

    // Still does not throw — the account row is already committed and a
    // provider outage must not fail registration. What changed with F-10 is
    // that the failure is now REPORTED to the caller instead of being
    // indistinguishable from success, so `EmailVerificationService.deliver()`
    // can log what happened rather than always logging "dispatched".
    const outcome = await service.sendEmailVerification({
      recipientEmail: 'a@b.test',
      recipientName: 'A',
      rawToken: 't',
    });

    expect(outcome).toEqual({ accepted: false });
  });

  it('reports acceptance, with the provider message id, on a successful verification send', async () => {
    const outcome = await service.sendEmailVerification({
      recipientEmail: 'a@b.test',
      recipientName: 'A',
      rawToken: 't',
    });

    expect(outcome).toEqual({
      accepted: true,
      providerMessageId: expect.any(String),
    });
  });

  it('swallows an unexpected non-email error as an error-level failure', async () => {
    sender.failWith(new Error('something entirely unexpected'));

    await expect(service.sendOrderConfirmation(orderFixture())).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('kind=unexpected');
  });
});

describe('render failure prevents any send', () => {
  /**
   * A half-rendered order confirmation is worse than none: the customer cannot
   * un-read "Your order  has been received", and the missing value is a
   * programming error that an alert can fix.
   */
  it('sends nothing when the template cannot be rendered', async () => {
    const broken = orderFixture();
    // Force a strict-mode miss by removing a field the template requires.
    delete (broken as unknown as Record<string, unknown>)['orderNumber'];

    await expect(service.sendOrderConfirmation(broken)).resolves.toBeUndefined();

    expect(sender.sent).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('no real provider is contacted', () => {
  it('uses only the injected port', () => {
    // Structural, not incidental: the service's dependencies are exactly the
    // renderer, the port and config. It has no HTTP client and no SDK to
    // reach for, so there is no path by which a test could send real mail.
    expect(sender.sent).toHaveLength(0);
    expect(service).toBeInstanceOf(NotificationsService);
  });
});
