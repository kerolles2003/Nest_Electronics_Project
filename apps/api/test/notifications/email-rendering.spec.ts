import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from '@jest/globals';
import { HandlebarsTemplateRenderer } from '../../src/modules/notifications/infrastructure/handlebars-template.renderer';
import { TEMPLATE_IDS } from '../../src/modules/notifications/application/templates/template-id';
import type { OrderPlacedData } from '../../src/modules/notifications/application/templates/order-placed.data';
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
    // Last, so a literal `&amp;#x3D;` cannot be double-decoded.
    .replace(/&amp;/g, '&');
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
  verifyUrl: 'https://shop.example.test/shop/verify-email?token=abc123',
  expiresIn: '24 hours',
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
  orderUrl: 'https://shop.example.test/shop/orders/68b000000000000000000001',
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
    expect(rendered.html).toMatch(/href="https:\/\/shop\.example\.test\/shop\/verify-email\?token/);
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
      expect(rendered.html).toContain(item.lineTotal);
      expect(rendered.text).toContain(item.name);
    }
    expect(rendered.html).toContain('735.50 EGP');
  });

  it('renders the delivery address from the snapshot', async () => {
    const rendered = await renderer.render('orders/order-placed', ORDER, 'en');

    expect(rendered.html).toContain('12 Sherif Street, Apartment 4');
    expect(rendered.html).toContain('Cairo');
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
    expect(rendered.html).toContain('50.00 EGP');
  });

  it('says delivery is not yet priced rather than claiming it is free', async () => {
    // A zero shipping fee currently means "the rate table is unsupplied"
    // (OPEN-001), and printing "0.00 EGP" would promise free delivery the
    // business has not agreed to.
    const rendered = await renderer.render('orders/order-placed', ORDER, 'en');

    expect(rendered.html).toContain('Calculated before dispatch');
  });

  it('prints the real fee once delivery is priced', async () => {
    const rendered = await renderer.render(
      'orders/order-placed',
      { ...ORDER, shippingUnpriced: false, shippingFree: false, shippingFee: '45.00 EGP' },
      'en',
    );

    expect(rendered.html).toContain('45.00 EGP');
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

    expect(rendered.html).toContain('Free');
    expect(rendered.html).not.toContain('Calculated before dispatch');

    expect(rendered.text).toContain('Free');
    expect(rendered.text).not.toContain('Calculated before dispatch');
  });

  it('never says both Free and not-calculated for one order', async () => {
    // The two flags are mutually exclusive by construction in
    // NotificationsService; this pins the template so a future edit cannot
    // render both branches.
    for (const variant of [
      { shippingUnpriced: true, shippingFree: false },
      { shippingUnpriced: false, shippingFree: true },
      { shippingUnpriced: false, shippingFree: false },
    ]) {
      const rendered = await renderer.render('orders/order-placed', { ...ORDER, ...variant }, 'en');
      const saysUnpriced = rendered.html.includes('Calculated before dispatch');
      const saysFree = rendered.html.includes('Free');

      expect(saysUnpriced && saysFree).toBe(false);
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
