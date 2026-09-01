/**
 * The transport boundary.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §5.1–§5.3.
 *
 * ONE method. Everything a caller needs; nothing a vendor needs. An abstract
 * CLASS rather than an interface because Nest resolves providers by runtime
 * token — an interface disappears at compile time and cannot be injected
 * without a hand-written string token, which is one more thing to typo.
 *
 * Nothing below this line knows what a template is; nothing above it knows
 * what an HTTP request to a mail vendor looks like.
 */
export abstract class EmailSenderPort {
  abstract send(message: OutboundEmail): Promise<EmailSendResult>;
}

/** A single addressee. `name` is a display name, not an identity claim. */
export interface EmailRecipient {
  readonly email: string;
  readonly name?: string;
}

/**
 * What the application asks to be delivered.
 *
 * `html` is ALREADY RENDERED (§5.6). The port receives content, never a
 * template reference — that single decision is what keeps templates in git
 * instead of in a vendor's dashboard, and what makes a provider swap a
 * zero-template-change operation.
 *
 * Deliberately absent, each for a reason:
 *
 *   from         infrastructure, not business. The adapter supplies it from
 *                config, so no caller can send from the wrong address.
 *   templateId   vendor-specific; rendering happens before this boundary.
 *   attachments  no requirement exists. The port grows deliberately.
 *   cc / bcc     no requirement exists.
 *   scheduling   no requirement exists.
 */
export interface OutboundEmail {
  readonly to: readonly EmailRecipient[];
  readonly subject: string;
  readonly html: string;
  /** Always populated. Plain text materially improves deliverability. */
  readonly text: string;
  readonly replyTo?: string;
  /** Provider-side categorisation, e.g. `{ type: 'order_placed' }`. */
  readonly tags?: Readonly<Record<string, string>>;
  /** Passed to providers that honour it, so a retry cannot double-send. */
  readonly idempotencyKey?: string;
}

/**
 * Proof of acceptance — NOT proof of delivery.
 *
 * A mail provider accepts a message and delivers it later; the inbox decision
 * happens minutes afterwards and is reported, if at all, by webhook. Naming
 * this `acceptedAt` rather than `sentAt` keeps that distinction visible at
 * every call site.
 *
 * `providerMessageId` is opaque and is never parsed, matched or interpreted —
 * only logged for support correlation. A provider change alters its format and
 * nothing breaks.
 */
export interface EmailSendResult {
  readonly providerMessageId: string;
  readonly acceptedAt: Date;
}
