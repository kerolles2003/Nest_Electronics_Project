import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from '@jest/globals';
import { HandlebarsTemplateRenderer } from '../../src/modules/notifications/infrastructure/handlebars-template.renderer';
import { TEMPLATE_IDS } from '../../src/modules/notifications/application/templates/template-id';
import type { OrderPlacedData } from '../../src/modules/notifications/application/templates/order-placed.data';
import type { PasswordResetData } from '../../src/modules/notifications/application/templates/password-reset.data';
import type { VerifyEmailData } from '../../src/modules/notifications/application/templates/verify-email.data';

/**
 * Template rendering, in isolation.
 *
 * NO DATABASE, NO NETWORK, NO PROVIDER. The renderer is a pure function of
 * (template id, data, locale), which is exactly why it sits behind a port: the
 * whole content layer is testable without booting an application or holding a
 * credential.
 *
 * Authority: docs/architecture/TEMPLATE-ARCHITECTURE.md §9.
 */

const TEMPLATE_ROOT = resolve(__dirname, '../../src/templates/email');

let renderer: HandlebarsTemplateRenderer;

/**
 * Undoes Handlebars' HTML escaping, so an assertion can name the URL a
 * customer actually navigates to.
 *
 * Handlebars escapes `=` to `&#x3D;`, so a verification link is stored in the
 * markup as `?token&#x3D;abc123`. That is CORRECT and deliberate — entities
 * decode in both attribute and text contexts, so the browser requests the
 * right URL, and escaping by default is what stops a future template field
 * carrying user text from becoming an injection. Asserting on the escaped
 * bytes would be asserting on an implementation detail; asserting on the
 * decoded string is asserting on what the reader gets.
 */
function decodeEntities(html: string): string {
  return html
    .replace(/&#x3D;/g, '=')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&minus;/g, '\u2212')
    .replace(/&times;/g, '\u00d7')
    // Last, so a literal `&amp;#x3D;` cannot be double-decoded.
    .replace(/&amp;/g, '&');
}

/**
 * The right-hand cell of one labelled row in the totals table.
 *
 * ## Why a whole-document `toContain` is not good enough here
 *
 * Every value in this block is a money string, and money strings nest: the
 * discount `50.00 EGP` is a substring of the line total `650.00 EGP`, so
 * `expect(html).toContain('50.00 EGP')` passed whether or not a Discount row
 * was ever rendered. Others were satisfied by a DIFFERENT number on the same
 * page — `735.50 EGP` appears three times (subtotal, total, amount due), so an
 * assertion aimed at the subtotal was really testing that at least one of the
 * three survived.
 *
 * Naming the row makes each assertion fail for the reason it claims.
 */
function summaryRow(html: string, label: string): string {
  const row = new RegExp(
    '<td[^>]*>\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>',
  ).exec(html);
  return row === null
    ? '<no ' + label + ' row>'
    : decodeEntities(row[1] ?? '')
        .replace(/<[^>]+>/g, '')
        .trim();
}

/**
 * The HTML reduced to the text a reader actually sees, whitespace collapsed.
 *
 * Line items are markup, not a table of scalars — the name and the
 * "qty x unit price" line share one cell, inside nested spans — so the honest
 * assertion for a line item is the whole composed line, in order. That ties
 * name, quantity, unit price and line total together; a substring search for
 * any one of them does not.
 */
function visibleText(html: string): string {
  return decodeEntities(html.replace(/<style[\s\S]*?<\/style>/g, ''))
    // Each tag becomes a SPACE, not nothing: `</span><br /><span>` carries no
    // whitespace of its own, so deleting the tags outright would weld the
    // product name onto the price that follows it.
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The same row, in the plain-text body, where the label starts the line. */
function textRow(text: string, label: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trimEnd())
    .find((l) => l.startsWith(label));
  return line === undefined ? '<no ' + label + ' line>' : line.slice(label.length).trim();
}

/**
 * Returns a copy without one key.
 *
 * Written out rather than destructured-with-rest because the discarded binding
 * that pattern creates is an unused variable, which this project lints as an
 * error. Being explicit also states the intent: the key is ABSENT, which is a
 * different thing from present-and-undefined — and the two take different code
 * paths through the renderer.
 */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const clone: T = { ...value };
  delete clone[key];
  return clone;
}

const VERIFY: VerifyEmailData = {
  customerName: 'Mina Kerolles',
  verifyUrl: 'https://shop.example.test/verify-email?token=abc123',
  expiresIn: '24 hours',
};

const RESET: PasswordResetData = {
  customerName: 'Mina Kerolles',
  resetUrl: 'https://shop.example.test/forgot-password/reset?token=xyz789',
  expiresIn: '1 hour',
};

const ORDER: OrderPlacedData = {
  customerName: 'Mina Kerolles',
  orderNumber: 'NE-20260831-0007',
  placedAt: '31 August 2026',
  status: 'PLACED',
  items: [
    { name: 'ESP32 DevKit V1', quantity: 2, unitPrice: '325.00 EGP', lineTotal: '650.00 EGP' },
    { name: 'Breadboard 830', quantity: 1, unitPrice: '85.50 EGP', lineTotal: '85.50 EGP' },
  ],
  itemsSubtotal: '735.50 EGP',
  discountTotal: '0.00 EGP',
  hasDiscount: false,
  shippingFee: '0.00 EGP',
  shippingUnpriced: true,
  shippingFree: false,
  grandTotal: '735.50 EGP',
  paymentMethod: 'Cash on delivery',
  amountDueOnDelivery: '735.50 EGP',
  shippingAddress: {
    fullName: 'Mina Kerolles',
    phone: '01012345678',
    street: '12 Sherif Street, Apartment 4',
    city: 'Downtown',
    governorate: 'Cairo',
    postalCode: null,
  },
  orderUrl: 'https://shop.example.test/account/orders/68b000000000000000000001',
};

beforeAll(() => {
  renderer = new HandlebarsTemplateRenderer();
  // Compilation is a lifecycle step, so a broken template fails at BOOT. This
  // call is therefore also the assertion that every template compiles.
  renderer.onModuleInit();
});

describe('template inventory', () => {
  it('every id in the union has both an .hbs and a .txt.hbs file', () => {
    for (const id of TEMPLATE_IDS) {
      expect({ id, html: existsSync(join(TEMPLATE_ROOT, 'en', `${id}.hbs`)) }).toEqual({
        id,
        html: true,
      });
      expect({ id, text: existsSync(join(TEMPLATE_ROOT, 'en', `${id}.txt.hbs`)) }).toEqual({
        id,
        text: true,
      });
    }
  });

  it('renders every id in the union', async () => {
    // Guards the case where a new id is added with files but no service method
    // and no fixture — it would still have to render.
    const fixtures: Record<string, object> = {
      'auth/verify-email': VERIFY,
      'auth/password-reset': RESET,
      'orders/order-placed': ORDER,
    };

    for (const id of TEMPLATE_IDS) {
      const fixture = fixtures[id];
      expect({ id, hasFixture: fixture !== undefined }).toEqual({ id, hasFixture: true });

      const rendered = await renderer.render(id, fixture as object, 'en');
      expect(rendered.subject.length).toBeGreaterThan(0);
      expect(rendered.html.length).toBeGreaterThan(0);
      expect(rendered.text.length).toBeGreaterThan(0);
    }
  });
});

describe('auth/password-reset', () => {
  it('puts the reset URL in both the HTML and the plain text', async () => {
    /*
     * BOTH, because a mail client picks one and the customer never sees the
     * other. A link present only in the HTML part is a dead email for anyone
     * reading in plain text, and that is exactly the reader who cannot work
     * around it.
     */
    const rendered = await renderer.render('auth/password-reset', RESET, 'en');

    // `decodeEntities` because Handlebars escapes `=` to `&#x3D;` in the HTML
    // part — the link is still navigable, and the plain-text part is compiled
    // with `noEscape` so it carries the URL verbatim.
    expect(decodeEntities(rendered.html)).toContain(RESET.resetUrl);
    expect(rendered.text).toContain(RESET.resetUrl);
  });

  it('states the ONE-HOUR expiry, not the verification email\'s day', async () => {
    // The two templates are deliberately similar and were written by copying.
    // This is the assertion that notices if the copy kept "24 hours".
    const rendered = await renderer.render('auth/password-reset', RESET, 'en');

    expect(rendered.text).toContain('1 hour');
    expect(rendered.text).not.toContain('24 hours');
  });

  it('tells the reader the reset signs them out everywhere', async () => {
    /*
     * Not decoration. The confirm endpoint revokes every session, so a customer
     * who resets on their phone is signed out on their laptop — and an email
     * that did not say so turns a security feature into a support ticket.
     */
    const rendered = await renderer.render('auth/password-reset', RESET, 'en');

    expect(rendered.text).toContain('signs you out everywhere');
  });

  it('warns a recipient who did not ask for it', async () => {
    // The single most useful sentence in a reset email: it is read by whoever
    // holds the mailbox, who may not be the person who asked.
    const rendered = await renderer.render('auth/password-reset', RESET, 'en');

    expect(rendered.text).toContain('If you did not ask for this');
    expect(rendered.html).toContain('If you did not ask for this');
  });

  it('carries a subject that says what it is', async () => {
    const rendered = await renderer.render('auth/password-reset', RESET, 'en');

    expect(rendered.subject).toBe('Reset your Nest Electronics password');
  });

  it('refuses to render with the URL missing', async () => {
    /*
     * Strict variable resolution, and the case that makes it worth having: a
     * reset email whose link silently rendered as an empty string would be
     * delivered, look plausible, and strand the customer.
     */
    await expect(
      renderer.render('auth/password-reset', without(RESET, 'resetUrl'), 'en'),
    ).rejects.toThrow();
  });
});

describe('auth/verify-email', () => {
  it('puts the verification URL in both the HTML and the plain text', async () => {
    const rendered = await renderer.render('auth/verify-email', VERIFY, 'en');

    expect(decodeEntities(rendered.html)).toContain(VERIFY.verifyUrl);
    // Plain text is compiled with `noEscape`, so it carries the URL verbatim.
    expect(rendered.text).toContain(VERIFY.verifyUrl);
  });

  it('escapes the link in HTML while keeping it navigable', async () => {
    const rendered = await renderer.render('auth/verify-email', VERIFY, 'en');

    // Escaped in the markup...
    expect(rendered.html).toContain('token&#x3D;abc123');
    // ...and present in the href, which is what the mail client follows.
    expect(rendered.html).toMatch(/href="https:\/\/shop\.example\.test\/verify-email\?token/);
  });

  it('takes its subject from the template front-matter, not from a service', async () => {
    const rendered = await renderer.render('auth/verify-email', VERIFY, 'en');

    expect(rendered.subject).toBe('Verify your email address');
    // The front-matter comment must not survive into the body.
    expect(rendered.html).not.toContain('subject:');
  });

  it('wraps the body in the shared layout', async () => {
    const rendered = await renderer.render('auth/verify-email', VERIFY, 'en');

    expect(rendered.html).toContain('<!doctype html>');
    expect(rendered.html).toContain('dir="ltr"');
    expect(rendered.html).toContain('Nest Electronics');
  });
});

describe('orders/order-placed', () => {
  it('interpolates the order number into the subject', async () => {
    const rendered = await renderer.render('orders/order-placed', ORDER, 'en');

    expect(rendered.subject).toBe('We received your order NE-20260831-0007');
  });

  it('renders every line item with its pre-formatted money', async () => {
    const rendered = await renderer.render('orders/order-placed', ORDER, 'en');

    for (const item of ORDER.items) {
      expect(rendered.html).toContain(item.name);
      expect(rendered.text).toContain(item.name);

      // The WHOLE line, not just the line total. `85.50 EGP` occurs twice for a
      // quantity-1 item — once as the unit price and once as the line total —
      // so asserting that substring alone still passed if the Total column were
      // dropped entirely.
      expect(rendered.text).toContain(
        `${String(item.quantity)} x ${item.unitPrice}  =  ${item.lineTotal}`,
      );
      expect(visibleText(rendered.html)).toContain(
        `${item.name} ${String(item.quantity)} \u00d7 ${item.unitPrice} ${item.lineTotal}`,
      );
    }

    // Named, because `735.50 EGP` is ALSO the grand total and the amount due.
    expect(summaryRow(rendered.html, 'Subtotal')).toBe('735.50 EGP');
    expect(textRow(rendered.text, 'Subtotal')).toBe('735.50 EGP');
  });

  it('renders the delivery address from the snapshot', async () => {
    const rendered = await renderer.render('orders/order-placed', ORDER, 'en');

    expect(rendered.html).toContain('12 Sherif Street, Apartment 4');
    // The composed line, not the bare governorate: 'Cairo' is a short word a
    // footer or a marketing line could reintroduce at any time, and this would
    // then pass without the address block rendering at all.
    expect(rendered.html).toContain('Downtown, Cairo');
    expect(rendered.html).toContain('01012345678');
  });

  it('omits the discount row when there is no discount', async () => {
    const rendered = await renderer.render('orders/order-placed', ORDER, 'en');

    expect(rendered.html).not.toContain('Discount');
  });

  it('shows the discount row when there is one', async () => {
    const rendered = await renderer.render(
      'orders/order-placed',
      { ...ORDER, hasDiscount: true, discountTotal: '50.00 EGP' },
      'en',
    );

    expect(rendered.html).toContain('Discount');
    // VACUOUS BEFORE: '50.00 EGP' is a substring of the line total
    // '650.00 EGP', so this passed with no Discount row rendered at all.
    // The minus sign is asserted too — it never was.
    expect(summaryRow(rendered.html, 'Discount')).toBe('\u221250.00 EGP');
  });

  it('says delivery is not yet priced rather than claiming it is free', async () => {
    // A zero shipping fee currently means "the rate table is unsupplied"
    // (OPEN-001), and printing "0.00 EGP" would promise free delivery the
    // business has not agreed to.
    const rendered = await renderer.render('orders/order-placed', ORDER, 'en');

    expect(summaryRow(rendered.html, 'Delivery')).toBe('Calculated before dispatch');
  });

  it('prints the real fee once delivery is priced', async () => {
    const rendered = await renderer.render(
      'orders/order-placed',
      { ...ORDER, shippingUnpriced: false, shippingFree: false, shippingFee: '45.00 EGP' },
      'en',
    );

    expect(summaryRow(rendered.html, 'Delivery')).toBe('45.00 EGP');
    expect(rendered.html).not.toContain('Calculated before dispatch');
    expect(rendered.html).not.toContain('Free');
  });

  /**
   * The third state, and the one the delivery line could not previously
   * express.
   *
   * A met free-shipping threshold produces a PRICED zero. Before this, the
   * template had two branches — unpriced, or the amount — so it printed
   * "0.00 EGP" for an order the checkout page had just called "Free". Same
   * fact, told two different ways to the same customer in the same minute.
   *
   * Asserted in BOTH renderings: the HTML partial and the plain-text template
   * carry the delivery line separately, and fixing one and not the other is
   * exactly the kind of miss a test should catch.
   */
  it('says Free for a PRICED zero, in both the HTML and the text body', async () => {
    const free = {
      ...ORDER,
      shippingUnpriced: false,
      shippingFree: true,
      shippingFee: '0.00 EGP',
    };

    const rendered = await renderer.render('orders/order-placed', free, 'en');

    expect(summaryRow(rendered.html, 'Delivery')).toBe('Free');
    expect(rendered.html).not.toContain('Calculated before dispatch');

    expect(textRow(rendered.text, 'Delivery')).toBe('Free');
    expect(rendered.text).not.toContain('Calculated before dispatch');
  });

  it('never says both Free and not-calculated for one order', async () => {
    // The two flags are mutually exclusive by construction in
    // NotificationsService; this pins the template so a future edit cannot
    // render both branches.
    // Asserted as ONE row with ONE value rather than as two independent
    // whole-document searches. "Never both" is implied by "is exactly this",
    // and the stronger form also catches a row that renders NEITHER — which the
    // old assertion scored as a pass.
    for (const [variant, expected] of [
      [{ shippingUnpriced: true, shippingFree: false }, 'Calculated before dispatch'],
      [{ shippingUnpriced: false, shippingFree: true }, 'Free'],
      [{ shippingUnpriced: false, shippingFree: false }, '0.00 EGP'],
    ] as const) {
      const rendered = await renderer.render('orders/order-placed', { ...ORDER, ...variant }, 'en');

      expect({ variant, delivery: summaryRow(rendered.html, 'Delivery') }).toEqual({
        variant,
        delivery: expected,
      });
    }
  });

  it('includes the postal code only when the address has one', async () => {
    const without = await renderer.render('orders/order-placed', ORDER, 'en');
    const with_ = await renderer.render(
      'orders/order-placed',
      { ...ORDER, shippingAddress: { ...ORDER.shippingAddress, postalCode: '11511' } },
      'en',
    );

    expect(without.html).not.toContain('11511');
    expect(with_.html).toContain('11511');
  });
});

describe('missing-variable behaviour (TEMPLATE-ARCHITECTURE.md §7)', () => {
  /**
   * THE test that justifies `strict: true`.
   *
   * The Handlebars default would render "We received your order " and send it.
   * A customer receiving that is worse than an alert, because the alert is
   * recoverable and the email is not.
   */
  it('throws rather than rendering a blank for a missing variable', async () => {
    await expect(
      renderer.render('orders/order-placed', without(ORDER, 'orderNumber'), 'en'),
    ).rejects.toThrow(/orderNumber/);
  });

  it('throws for a missing nested field', async () => {
    await expect(
      renderer.render(
        'orders/order-placed',
        { ...ORDER, shippingAddress: without(ORDER.shippingAddress, 'phone') },
        'en',
      ),
    ).rejects.toThrow();
  });

  it('does not throw for an explicitly null optional field', async () => {
    // `postalCode: null` is PRESENT-and-empty, which is a deliberate contract
    // decision — not the same thing as absent.
    await expect(renderer.render('orders/order-placed', ORDER, 'en')).resolves.toBeDefined();
  });
});

describe('plain-text output', () => {
  it('is not HTML-escaped', async () => {
    const rendered = await renderer.render(
      'orders/order-placed',
      { ...ORDER, customerName: 'Mina & Co' },
      'en',
    );

    expect(rendered.text).toContain('Mina & Co');
    expect(rendered.text).not.toContain('Mina &amp; Co');
    // …while the HTML version IS escaped, which is the whole point of having
    // two compilations.
    expect(rendered.html).toContain('Mina &amp; Co');
  });

  it('carries no HTML tags', async () => {
    const rendered = await renderer.render('orders/order-placed', ORDER, 'en');

    expect(rendered.text).not.toMatch(/<(table|div|html|a\s)/i);
  });
});

describe('locale fallback', () => {
  it('falls back to en for a locale with no templates', async () => {
    // Arabic templates are structured for but not built (§8). Falling back is
    // what makes adding them additive rather than a breaking change.
    const rendered = await renderer.render('auth/verify-email', VERIFY, 'ar');

    expect(rendered.subject).toBe('Verify your email address');
  });

  it('marks text direction from the requested locale', async () => {
    const arabic = await renderer.render('auth/verify-email', VERIFY, 'ar');

    // The layout reserves `dir` as a data value, so RTL never needs a second
    // layout — even while the copy is still English.
    expect(arabic.html).toContain('dir="rtl"');
  });
});
