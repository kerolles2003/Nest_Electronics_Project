import { Inject, Injectable, Logger } from '@nestjs/common';
import { appConfig, type AppConfig } from '../../../config/app.config';
import { MoneyDto } from '../../../common/dto/money.dto';
import { DEFAULT_LOCALE, resolveText, type Locale } from '../../../common/localization/locale';
import type { PlacedOrder } from '../../orders/application/checkout.service';
import { EmailDeliveryError } from './ports/email-errors';
import { EmailSenderPort, type OutboundEmail } from './ports/email-sender.port';
import { TemplateRendererPort } from './ports/template-renderer.port';
import type { TemplateId } from './templates/template-id';
import type { OrderPlacedData, OrderPlacedItem } from './templates/order-placed.data';
import type { PasswordResetData } from './templates/password-reset.data';
import type { VerifyEmailData } from './templates/verify-email.data';

/**
 * Upper bound on how long a send may hold the caller.
 *
 * Order confirmation is dispatched after the transaction commits but before
 * the HTTP response returns, so a provider hanging for its own timeout would
 * make a customer stare at a spinner after their order was already safely
 * placed. Ten seconds is far above a healthy send (~200 ms) and far below the
 * point at which a person assumes the checkout broke.
 */
const SEND_TIMEOUT_MS = 10_000;

/** Matches the 24-hour TTL in `EmailVerificationService`. Display copy only. */
const VERIFICATION_EXPIRY_COPY = '24 hours';

/**
 * Display copy for the reset TTL. One hour, per AUTHORIZATION-MODEL.md §2.8.
 *
 * A literal beside the verification one rather than derived from
 * `RESET_TTL_MS`, which lives in AuthModule: this module deliberately imports
 * nothing from a domain module (§4.14, it is a sink), and a template's copy is
 * content rather than a computation. The pairing is asserted by
 * `password-reset.spec.ts`, so the two cannot drift silently.
 */
const PASSWORD_RESET_EXPIRY_COPY = '1 hour';

/**
 * What actually happened to a message — the return value F-10 exists to
 * provide.
 *
 * `NotificationsService` never throws: a provider outage must not fail a
 * registration whose account row is already committed. The cost of that
 * contract used to be that a caller could not tell success from failure, so
 * `EmailVerificationService.deliver()` logged "dispatched" unconditionally —
 * including immediately after a 401 from the provider. The log said the
 * opposite of what had happened, which is worse than saying nothing.
 *
 * A returned outcome fixes that without weakening the no-throw contract: a
 * caller with something truthful to report can report it, and a caller with no
 * action available can keep ignoring it.
 *
 * `accepted` means the TRANSPORT took the message, matching `EmailSendResult`'s
 * `acceptedAt` — it is not proof of delivery to an inbox, and nothing here
 * should ever be logged as if it were.
 */
export type EmailDispatchResult =
  | { readonly accepted: true; readonly providerMessageId: string }
  | { readonly accepted: false };

export interface EmailVerificationNotification {
  readonly recipientEmail: string;
  readonly recipientName: string;
  /** The raw single-use token. Never logged — it is a bearer credential. */
  readonly rawToken: string;
}

export interface PasswordResetNotification {
  readonly recipientEmail: string;
  readonly recipientName: string;
  /**
   * The raw single-use token. Never logged, and a stronger credential than a
   * verification token: holding it is enough to take the account.
   */
  readonly rawToken: string;
}

/**
 * Every transactional email the application sends.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §2;
 *            docs/architecture/TEMPLATE-ARCHITECTURE.md §2, §11;
 *            docs/architecture/ORDER-LIFECYCLE.md §12;
 *            docs/architecture/NESTJS-MODULE-MAP.md §4.14.
 *
 * ## A sink, structurally
 *
 * This module is called by `AuthModule` and `OrdersModule` and calls no domain
 * module back. That is what makes the dependency graph acyclic by
 * construction rather than by discipline (NESTJS-MODULE-MAP.md §1 rule 4).
 * Note the imports: config, money and locale helpers, and one *type* from
 * orders. No repository, no service, no schema.
 *
 * ## The two-step separation
 *
 * `OrdersModule` injects THIS class, never `EmailSenderPort`. The port sits one
 * module deeper on purpose: if orders injected it directly, order code would
 * have to know about subjects, recipients and templates, and a change in email
 * semantics would ripple into checkout. Here the blast radius of any email
 * change is exactly one module.
 *
 * ## Failure policy — deliberate, and the same for both events
 *
 * **No method here throws.** A caller cannot fail because of email, because
 * every business fact these emails describe is ALREADY COMMITTED by the time
 * this class is reached. Rolling back a paid-for order because a mail provider
 * had a bad minute would destroy real value to protect a notification; the
 * order is the asset, the email is a courtesy about it.
 *
 * What happens instead is graded by whether the failure is ours:
 *
 *   retryable (transport, rate limit)  `warn`  — weather; the recovery path is
 *                                               the customer's own order page,
 *                                               or resend-verification
 *   not retryable (recipient, config)  `error` — a defect or a misconfiguration
 *                                               that a human must fix, and in
 *                                               the config case it is failing
 *                                               EVERY send, not this one
 *
 * There is deliberately **no retry, no queue and no outbox**. This is an
 * at-most-once dispatcher and is documented as one — see the report and
 * REDIS-DECISION.md. The honest trigger for changing that is a measured
 * failure rate, not a hypothetical one.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly renderer: TemplateRendererPort,
    private readonly sender: EmailSenderPort,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /**
   * The email that lets a new account sign in.
   *
   * The raw token appears in exactly one place — the URL in the body — and in
   * no log line, here or anywhere else. It is a bearer credential for an
   * account, and OBSERVABILITY.md §4 puts tokens on the mandatory redaction
   * list.
   *
   * If this fails the account still exists and is still unverified, so the
   * customer is not stranded: `POST /auth/resend-verification` mints a fresh
   * challenge and is reachable from the sign-in screen. That self-service path
   * is why a failure here is survivable rather than account-destroying.
   */
  async sendEmailVerification(input: EmailVerificationNotification): Promise<EmailDispatchResult> {
    const data: VerifyEmailData = {
      customerName: input.recipientName,
      /*
       * The CANONICAL path, not the `/shop` one it used to carry.
       *
       * These links live in a customer's inbox for as long as the token is
       * valid, and `/shop/*` is being removed. A 301 would carry them for a
       * while, but a link that has to be redirected to work is a link that
       * breaks the day someone tidies the redirect away.
       */
      verifyUrl: `${this.app.siteUrl}/verify-email?token=${encodeURIComponent(input.rawToken)}`,
      expiresIn: VERIFICATION_EXPIRY_COPY,
    };

    return this.dispatch({
      templateId: 'auth/verify-email',
      data,
      to: [{ email: input.recipientEmail, name: input.recipientName }],
      tags: { type: 'email_verification' },
      context: 'email verification',
      // No idempotency key: a resend is a DELIBERATE second send of a
      // deliberately different token, and de-duplicating it would break the
      // recovery path above.
    });
  }

  /**
   * The email that lets someone back into an account they are locked out of.
   *
   * The raw token appears in exactly one place — the URL in the body — and in
   * no log line. OBSERVABILITY.md §4 puts tokens on the mandatory redaction
   * list, and this one is the strongest in the system: holding it is enough to
   * take the account.
   *
   * NO IDEMPOTENCY KEY, and for the same reason verification has none: asking
   * again is a deliberate second send of a deliberately different token, and
   * de-duplicating it would break the only recovery path a customer has when
   * the first mail does not arrive.
   *
   * The URL points at `/forgot-password/reset`, which the storefront serves
   * — the storefront half of this is Phase 5b. The API is complete and testable
   * without it, and a link to a 404 is better than a link that silently points
   * at the wrong route once the page lands.
   */
  async sendPasswordReset(input: PasswordResetNotification): Promise<EmailDispatchResult> {
    const data: PasswordResetData = {
      customerName: input.recipientName,
      resetUrl:
        `${this.app.siteUrl}/forgot-password/reset?token=` +
        encodeURIComponent(input.rawToken),
      expiresIn: PASSWORD_RESET_EXPIRY_COPY,
    };

    return this.dispatch({
      templateId: 'auth/password-reset',
      data,
      to: [{ email: input.recipientEmail, name: input.recipientName }],
      tags: { type: 'password_reset' },
      context: 'password reset',
    });
  }

  /**
   * The "we have your order" email.
   *
   * Called only with an order that is already durably committed, and reads
   * every value from that persisted snapshot. Nothing here consults the cart,
   * the catalogue or the address book: the order is a historical record, and a
   * price or address that changes tomorrow must not change what this email
   * said today.
   *
   * `idempotencyKey` is the ORDER id — stable, unique, and already the thing
   * that makes placement itself replay-safe — so a provider that honours the
   * header cannot double-send even if this method were somehow reached twice.
   *
   * ## Why this still returns `void` when `sendEmailVerification` does not
   *
   * Its only caller is `CheckoutService`, post-commit, where the order already
   * exists and no branch on the mail outcome is available or wanted — the
   * customer has bought something either way. Returning a result a caller
   * cannot act on would invite exactly the wrong reaction: failing or retrying
   * a placement because an email did not go out. The transport-level outcome is
   * already logged by `dispatch`/`report`.
   */
  async sendOrderConfirmation(order: PlacedOrder, locale: Locale = DEFAULT_LOCALE): Promise<void> {
    const orderId = order._id.toHexString();

    void (await this.dispatch({
      templateId: 'orders/order-placed',
      data: NotificationsService.toOrderPlacedData(order, locale, this.app.siteUrl),
      to: [{ email: order.customer.email, name: order.customer.fullName }],
      tags: { type: 'order_placed', orderNumber: order.orderNumber },
      idempotencyKey: `order-placed:${orderId}`,
      context: `order ${order.orderNumber}`,
      locale,
    }));
  }

  /**
   * Render, then send. The single place either can fail.
   *
   * Render comes FIRST and its failure prevents the send entirely — a missing
   * template variable throws in strict mode (TEMPLATE-ARCHITECTURE.md §7), and
   * the correct response to "we cannot produce this email correctly" is to
   * produce no email at all. A half-rendered order confirmation reaching a
   * customer is worse than none reaching them.
   */
  private async dispatch(request: {
    templateId: TemplateId;
    data: object;
    to: OutboundEmail['to'];
    tags: Record<string, string>;
    context: string;
    idempotencyKey?: string;
    locale?: Locale;
  }): Promise<EmailDispatchResult> {
    try {
      const rendered = await this.renderer.render(
        request.templateId,
        request.data,
        request.locale ?? DEFAULT_LOCALE,
      );

      const result = await NotificationsService.withTimeout(
        this.sender.send({
          to: request.to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: request.tags,
          // Spread rather than assigned: `exactOptionalPropertyTypes` draws a
          // real distinction between "absent" and "present but undefined", and
          // an absent idempotency key is what a deliberate resend needs.
          ...(request.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.idempotencyKey }),
        }),
      );

      // The recipient address is NOT logged. It is personal data, the log is
      // not the place for it, and the template id plus the business context
      // are what an operator actually needs to answer "was it sent?".
      this.logger.log(
        `email accepted  template=${request.templateId}  ${request.context}  ` +
          `messageId=${result.providerMessageId}`,
      );

      return { accepted: true, providerMessageId: result.providerMessageId };
    } catch (error) {
      this.report(error, request.templateId, request.context);

      // Reported, not rethrown — the class contract is unchanged. The outcome
      // is RETURNED so a caller that has something truthful to say about it can
      // say it (F-10), instead of every caller assuming success.
      return { accepted: false };
    }
  }

  /**
   * Grades a failure and records it. Never rethrows — see the class comment.
   */
  private report(error: unknown, templateId: TemplateId, context: string): void {
    const summary = `email NOT sent  template=${templateId}  ${context}`;

    if (error instanceof EmailDeliveryError) {
      const line = `${summary}  kind=${error.name}  retryable=${String(error.retryable)}  reason=${error.message}`;

      if (error.retryable) {
        this.logger.warn(line);
      } else {
        // Not weather. Either the address is wrong or our configuration is,
        // and in the configuration case every other send is failing too.
        this.logger.error(line);
      }
      return;
    }

    // A render failure or a genuine bug. Always an error: it is ours.
    this.logger.error(
      `${summary}  kind=unexpected  reason=${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }

  /**
   * Bounds a send so a hanging provider cannot hold an HTTP response open.
   *
   * `Promise.race` attaches a handler to the send promise, so a rejection that
   * arrives after the timeout is consumed by the race rather than surfacing as
   * an unhandled rejection that would take the process down.
   */
  private static withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;

    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`email send exceeded ${String(SEND_TIMEOUT_MS)}ms`)),
        SEND_TIMEOUT_MS,
      );
    });

    return Promise.race([operation, expiry]).finally(() => {
      clearTimeout(timer);
    }) as Promise<T>;
  }

  /**
   * Persisted order → template contract.
   *
   * The ONLY place order data becomes email data, and the reason a Mongoose
   * document never reaches a template (TEMPLATE-ARCHITECTURE.md §5 rule 1).
   * `productId`, `sku`, `imagePublicId`, `userId`, `idempotencyKey`,
   * `adminNote` and `statusHistory` all stop here — several of them are
   * internal, and an entity field added next month cannot leak into a customer
   * inbox through a mapping that names every field it copies.
   *
   * Every money value goes through `MoneyDto`, the same formatter the HTTP
   * layer uses, so the total in the email and the total on the order page are
   * one expression evaluated twice rather than two implementations that can
   * disagree.
   */
  private static toOrderPlacedData(
    order: PlacedOrder,
    locale: Locale,
    siteUrl: string,
  ): OrderPlacedData {
    const currency = order.currency;
    const money = (amount: number): string => MoneyDto.of(amount, currency).formatted;

    const items: OrderPlacedItem[] = order.items.map((item) => ({
      name: resolveText(item.name, locale),
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      lineTotal: money(item.lineTotal),
    }));

    return {
      customerName: order.customer.fullName,
      orderNumber: order.orderNumber,
      placedAt: NotificationsService.formatDate(order.placedAt),
      status: order.status,

      items,

      itemsSubtotal: money(order.pricing.itemsSubtotal),
      discountTotal: money(order.pricing.discountTotal),
      // Computed HERE, not in the template. "Show the discount row when a
      // discount applies" is a business rule, and a logic-less template engine
      // is what forces it to live somewhere testable.
      hasDiscount: order.pricing.discountTotal > 0,
      shippingFee: money(order.pricing.shippingFee),
      /*
       * The delivery line has THREE outcomes, and both booleans are computed
       * here rather than in the template.
       *
       * Read from the order's own flag, never inferred from the amount.
       * `shippingFee === 0` was the old test, and it is wrong in both
       * directions: it calls a genuinely free delivery "Calculated before
       * dispatch", and once real rates exist it would call every zero a price.
       * The order records which one it was at placement time.
       *
       *   unpriced -> "Calculated before dispatch"
       *   free     -> "Free"          (priced, and the price is zero)
       *   priced   -> the amount
       *
       * `shippingFree` exists because without it the email printed "0.00 EGP"
       * for an order the checkout page had just described as "Free" — the same
       * fact, told two different ways to the same customer.
       */
      shippingUnpriced: !order.pricing.shippingPriced,
      shippingFree: order.pricing.shippingPriced && order.pricing.shippingFee === 0,
      grandTotal: money(order.pricing.grandTotal),

      paymentMethod: NotificationsService.PAYMENT_COPY[order.payment.method] ?? order.payment.method,
      // Under COD the whole total is due at the door. When another payment
      // method exists this becomes a real branch; today it is one fact stated
      // once rather than a speculative abstraction.
      amountDueOnDelivery: money(order.pricing.grandTotal),

      shippingAddress: {
        fullName: order.shippingAddress.fullName,
        phone: order.shippingAddress.phone,
        street: order.shippingAddress.street,
        city: order.shippingAddress.city,
        governorate: order.shippingAddress.governorate,
        postalCode: order.shippingAddress.postalCode,
      },

      // Canonical, for the same reason as `verifyUrl` above.
      orderUrl: `${siteUrl}/account/orders/${order._id.toHexString()}`,
    };
  }

  /** Customer-facing wording for a payment method code. */
  private static readonly PAYMENT_COPY: Readonly<Record<string, string>> = {
    COD: 'Cash on delivery',
  };

  /**
   * `31 August 2026`. Deliberately not the ISO string the API returns on the
   * wire: a machine contract and a sentence a person reads are different
   * things, and only one of them belongs in an email.
   */
  private static formatDate(value: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(value);
  }
}
