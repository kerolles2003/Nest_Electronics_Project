import { Module } from '@nestjs/common';
import { NotificationsService } from './application/notifications.service';
import { TemplateRendererPort } from './application/ports/template-renderer.port';
import { HandlebarsTemplateRenderer } from './infrastructure/handlebars-template.renderer';

/**
 * Transactional email as a business capability.
 *
 * Authority: docs/architecture/NESTJS-MODULE-MAP.md §4.14;
 *            docs/architecture/PROVIDER-ARCHITECTURE.md §2.
 *
 * ## A sink
 *
 * Imports no domain module and is imported by several. That asymmetry is the
 * structural guarantee against dependency cycles (§1 rule 4) — and the reason
 * an architecture test can assert it mechanically rather than relying on
 * anybody remembering.
 *
 * ## What it owns and what it does not
 *
 * Owns: which event sends which template, the typed data contracts, and the
 * rendering mechanism. Does NOT own transmission — `EmailSenderPort` is
 * satisfied by `ProvidersModule`, which is `@Global`, so this module names no
 * vendor and needs no import for one.
 *
 * The renderer is bound here rather than under `providers/` deliberately:
 * Handlebars is a library, not a replaceable external service. There is no
 * account, no API key and no network call. It sits behind a port for
 * testability and for the deferred MJML migration, not for vendor
 * replaceability (TEMPLATE-ARCHITECTURE.md §11).
 */
@Module({
  providers: [
    NotificationsService,
    { provide: TemplateRendererPort, useClass: HandlebarsTemplateRenderer },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
