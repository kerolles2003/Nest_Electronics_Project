import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Handlebars from 'handlebars';
import { DEFAULT_LOCALE, type Locale } from '../../../common/localization/locale';
import {
  TemplateRendererPort,
  type RenderedEmail,
} from '../application/ports/template-renderer.port';
import { TEMPLATE_IDS, type TemplateId } from '../application/templates/template-id';

/**
 * Resolved from THIS file, not from `process.cwd()`.
 *
 * `cwd` is whatever directory the operator happened to be in — it differs
 * between `pnpm dev`, `node dist/main.js`, a Docker `WORKDIR` and a jest run,
 * and a template path that works in four of those and not the fifth is a
 * production-only failure. Relative to `__dirname` the depth is identical in
 * `src/` and in `dist/` (`modules/notifications/infrastructure` → root), so
 * one expression is correct in both.
 */
const TEMPLATE_ROOT = resolve(__dirname, '../../../templates/email');

/**
 * `{{!-- subject: … --}}` on the first line of a `.hbs` file.
 *
 * The subject is CONTENT: written in the same voice as the body, changed with
 * the body, localised with the body. Keeping it as a string literal in a
 * service guarantees the two drift apart.
 */
const SUBJECT_FRONT_MATTER = /^\s*\{\{!--\s*subject:\s*([\s\S]*?)\s*--\}\}/;

interface CompiledTemplate {
  readonly subject: HandlebarsTemplateDelegate;
  readonly html: HandlebarsTemplateDelegate;
  readonly text: HandlebarsTemplateDelegate;
}

/**
 * Handlebars rendering, compiled once at boot.
 *
 * Authority: docs/architecture/TEMPLATE-ARCHITECTURE.md §4, §6, §7.
 *
 * ## Two decisions worth stating
 *
 * **Compiled at boot, not per send.** A syntax error in a template is then a
 * startup failure — discovered by the deploy, in front of the person who
 * caused it — rather than a 3 a.m. exception on the one code path that sends
 * that particular mail. It also removes compilation from the hot path.
 *
 * **`strict: true`.** The Handlebars default renders an unresolved
 * `{{orderNumber}}` as an empty string, producing "Your order  has been
 * received" — and sends it. For transactional mail that is unacceptable: the
 * variable is missing only because of a programming error, and mailing a
 * garbled message to every customer compounds it irreversibly. Strict mode
 * turns it into a throw, and `NotificationsService` then sends nothing at all.
 *
 * Optional content stays expressible: every data contract declares its
 * optional fields explicitly (`postalCode: string | null`, `hasDiscount:
 * boolean`), so the key is always PRESENT and `{{#if}}` sees a real value.
 * "Optional" and "absent" are different things here, deliberately.
 */
@Injectable()
export class HandlebarsTemplateRenderer extends TemplateRendererPort implements OnModuleInit {
  private readonly logger = new Logger(HandlebarsTemplateRenderer.name);
  private readonly env = Handlebars.create();
  /** Keyed `<locale>:<templateId>`. */
  private readonly compiled = new Map<string, CompiledTemplate>();
  private layoutHtml!: HandlebarsTemplateDelegate;
  private layoutText!: HandlebarsTemplateDelegate;

  onModuleInit(): void {
    this.registerHelpers();
    this.registerPartials();
    this.compileLayouts();
    this.compileTemplates();

    this.logger.log(
      `email templates compiled  count=${String(this.compiled.size)}  root=${TEMPLATE_ROOT}`,
    );
  }

  async render<T extends object>(
    templateId: TemplateId,
    data: T,
    locale: Locale,
  ): Promise<RenderedEmail> {
    const resolved = this.resolve(templateId, locale);

    // Closes a real gap in `strict: true`. Handlebars throws when a key is
    // ABSENT from the context, but renders a key that is PRESENT WITH VALUE
    // `undefined` as an empty string — and every data contract here is built
    // by a mapping that always assigns every key. So the one failure the
    // strict flag is meant to prevent ("Your order  has been received") was
    // still reachable through it. Checked explicitly, the §7 guarantee is
    // total rather than nearly so.
    HandlebarsTemplateRenderer.assertNoUndefined(data, templateId);

    const context = { ...data };

    // Body first: a strict-mode failure then aborts before any output exists
    // that could be mistaken for a result.
    const bodyHtml = resolved.html(context);
    const bodyText = resolved.text(context);
    const subject = resolved.subject(context).trim();

    return Promise.resolve({
      subject,
      html: this.layoutHtml({ ...this.chrome(locale), body: bodyHtml, subject }),
      text: this.layoutText({ ...this.chrome(locale), body: bodyText, subject }),
    });
  }

  /**
   * Falls back to `en` when a locale has no copy of a template.
   *
   * Sending the English version is strictly better than sending nothing, and
   * strictly better than failing an order confirmation. It is also what makes
   * Arabic purely additive — a half-translated `ar/` directory works from its
   * first file (TEMPLATE-ARCHITECTURE.md §8).
   */
  private resolve(templateId: TemplateId, locale: Locale): CompiledTemplate {
    const exact = this.compiled.get(`${locale}:${templateId}`);
    if (exact !== undefined) {
      return exact;
    }

    const fallback = this.compiled.get(`${DEFAULT_LOCALE}:${templateId}`);
    if (fallback === undefined) {
      // Unreachable while the inventory test passes; a throw beats a silent
      // empty email if it ever is reached.
      throw new Error(`Email template not compiled: ${templateId}`);
    }

    return fallback;
  }

  /**
   * Walks the data contract and rejects any `undefined` value.
   *
   * Recursive because the contracts nest one level (`shippingAddress`,
   * `items[]`), and a blank street line is exactly as damaging as a blank
   * order number. `null` is explicitly ALLOWED: the contracts use it to mean
   * "genuinely optional and known to be absent", which `{{#if}}` handles
   * deliberately. `undefined` means "nobody set this", which is a defect.
   */
  private static assertNoUndefined(value: unknown, templateId: TemplateId, path = ''): void {
    if (value === undefined) {
      throw new Error(
        `Email template '${templateId}' received undefined for '${path || '(root)'}'. ` +
          `A missing value is a defect, not a blank — refusing to render.`,
      );
    }

    if (value === null || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        HandlebarsTemplateRenderer.assertNoUndefined(entry, templateId, `${path}[${String(index)}]`);
      });
      return;
    }

    // Dates and other class instances are values, not contracts to descend
    // into: `Object.entries` on a Date is empty anyway, and walking arbitrary
    // instances would be a needless traversal of somebody else's internals.
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      HandlebarsTemplateRenderer.assertNoUndefined(
        nested,
        templateId,
        path === '' ? key : `${path}.${key}`,
      );
    }
  }

  /** Layout-only values. Not part of any template's data contract. */
  private chrome(locale: Locale): Record<string, string | number> {
    return {
      textDirection: locale === 'ar' ? 'rtl' : 'ltr',
      year: new Date().getUTCFullYear(),
    };
  }

  /**
   * A CLOSED set of formatters, none of which contains a business rule.
   *
   * `formatMoney` is absent on purpose: money arrives pre-formatted, because
   * formatting is a business decision owned by `MoneyDto`, and a second
   * implementation here would be a second answer to "what does 32500 cost?".
   */
  private registerHelpers(): void {
    // Exists so `{{qty quantity}}` reads deliberately rather than relying on
    // Handlebars' default stringification of a number.
    this.env.registerHelper('qty', (value: unknown) =>
      typeof value === 'number' ? String(value) : '',
    );
  }

  private registerPartials(): void {
    const dir = join(TEMPLATE_ROOT, DEFAULT_LOCALE, 'partials');
    if (!existsSync(dir)) {
      return;
    }

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.hbs')) {
        continue;
      }
      this.env.registerPartial(file.replace(/\.hbs$/, ''), readFileSync(join(dir, file), 'utf8'));
    }
  }

  private compileLayouts(): void {
    const dir = join(TEMPLATE_ROOT, DEFAULT_LOCALE, 'layouts');

    this.layoutHtml = this.env.compile(readFileSync(join(dir, 'base.hbs'), 'utf8'), {
      strict: true,
    });
    // `noEscape` because this output is plain text: escaping would put a
    // literal `&amp;` in front of a customer.
    this.layoutText = this.env.compile(readFileSync(join(dir, 'base.txt.hbs'), 'utf8'), {
      strict: true,
      noEscape: true,
    });
  }

  /**
   * Compiles every id in the union, for every locale directory present.
   *
   * Driven by `TEMPLATE_IDS` rather than by a directory walk, so both failure
   * directions surface here, at boot: an id with no file, and a file with no
   * plain-text sibling or no subject.
   */
  private compileTemplates(): void {
    for (const locale of readdirSync(TEMPLATE_ROOT)) {
      for (const id of TEMPLATE_IDS) {
        const htmlPath = join(TEMPLATE_ROOT, locale, `${id}.hbs`);
        const textPath = join(TEMPLATE_ROOT, locale, `${id}.txt.hbs`);

        if (!existsSync(htmlPath)) {
          continue;
        }

        if (!existsSync(textPath)) {
          throw new Error(
            `Email template '${id}' (${locale}) has no plain-text sibling. ` +
              `OutboundEmail.text is always populated, so ${id}.txt.hbs is required.`,
          );
        }

        const rawHtml = readFileSync(htmlPath, 'utf8');
        const subject = SUBJECT_FRONT_MATTER.exec(rawHtml)?.[1];

        if (subject === undefined) {
          throw new Error(
            `Email template '${id}' (${locale}) has no subject front-matter. ` +
              `Add {{!-- subject: … --}} as its first line.`,
          );
        }

        this.compiled.set(`${locale}:${id}`, {
          subject: this.env.compile(subject, { strict: true, noEscape: true }),
          html: this.env.compile(rawHtml.replace(SUBJECT_FRONT_MATTER, ''), { strict: true }),
          text: this.env.compile(readFileSync(textPath, 'utf8'), {
            strict: true,
            noEscape: true,
          }),
        });
      }
    }
  }
}
