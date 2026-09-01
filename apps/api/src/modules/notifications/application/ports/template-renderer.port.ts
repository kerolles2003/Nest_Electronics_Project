import type { Locale } from '../../../../common/localization/locale';
import type { TemplateId } from '../templates/template-id';

/**
 * The rendering boundary.
 *
 * Authority: docs/architecture/TEMPLATE-ARCHITECTURE.md §6.
 *
 * This port exists for TESTABILITY and for a possible future move to MJML —
 * NOT for vendor replaceability. Handlebars is a library, not an external
 * service: there is no account, no API key and no network call, which is
 * exactly why the implementation lives in this module's `infrastructure/` and
 * not under `providers/`.
 */
export abstract class TemplateRendererPort {
  /**
   * Renders a template to its three parts.
   *
   * `data` is the template's own typed contract, never a domain entity —
   * see TEMPLATE-ARCHITECTURE.md §5 rule 1.
   *
   * Throws rather than returning a partial render when a referenced variable
   * is missing (§7): a customer reading "Your order  has shipped" is worse
   * than an alert.
   *
   * Returns a promise although Handlebars is synchronous. The frozen signature
   * is async (§6) to keep the deferred MJML migration — which needs a compile
   * step — from becoming a breaking change at every call site. The cost today
   * is one `await`; the alternative cost later is editing every caller.
   */
  abstract render<T extends object>(
    templateId: TemplateId,
    data: T,
    locale: Locale,
  ): Promise<RenderedEmail>;
}

/** Subject travels WITH the body, because it is content and localised alongside it. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}
