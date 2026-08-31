/**
 * Localised catalogue text.
 *
 * Authority: docs/architecture/CATALOG-MODEL.md §3 — user-facing catalogue text
 * is `{ en, ar? }`; `en` is required, `ar` optional. MVP populates `en` only,
 * because all 85 legacy Arabic columns were 100% NULL and Arabic is a funded
 * post-MVP roadmap item. The object costs one nesting level today and makes
 * Arabic purely additive later.
 */
export interface LocalizedTextValue {
  readonly en: string;
  readonly ar?: string | null;
}

/** The locales the API resolves. Requesting anything else falls back to `en`. */
export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Picks a locale from an `Accept-Language` header.
 *
 * Deliberately NOT a full RFC 4647 negotiation with q-weights and fallback
 * chains: two locales exist and one of them has no content. A full i18n
 * framework here would be the overengineering the architecture forbids.
 */
export function parseAcceptLanguage(header: string | undefined): Locale {
  if (header === undefined) {
    return DEFAULT_LOCALE;
  }

  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';

    if (tag === 'ar' || tag.startsWith('ar-')) {
      return 'ar';
    }
    if (tag === 'en' || tag.startsWith('en-')) {
      return 'en';
    }
  }

  return DEFAULT_LOCALE;
}

/**
 * Resolves localised text to a flat string.
 *
 * Clients receive `"name": "ESP32 DevKit V1"`, never `{ en, ar }` — the Flutter
 * client generates one Dart model, not a locale-aware value object. Missing
 * Arabic falls back to English rather than returning an empty string.
 */
export function resolveText(value: LocalizedTextValue, locale: Locale): string {
  if (locale === 'ar') {
    const arabic = value.ar;
    if (arabic !== null && arabic !== undefined && arabic.length > 0) {
      return arabic;
    }
  }

  return value.en;
}

/** Same, for an optional field. */
export function resolveOptionalText(
  value: LocalizedTextValue | null | undefined,
  locale: Locale,
): string | null {
  return value === null || value === undefined ? null : resolveText(value, locale);
}
