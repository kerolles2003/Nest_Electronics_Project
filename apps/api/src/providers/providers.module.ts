import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { emailConfig, type EmailConfig } from '../config/email.config';
import { EmailSenderPort } from '../modules/notifications/application/ports/email-sender.port';
import { BrevoEmailSender } from './email/brevo/brevo-email-sender';
import { brevoConfig, type BrevoConfig } from './email/brevo/brevo.config';
import { ConsoleEmailSender } from './email/console/console-email-sender';
import { ResendEmailSender } from './email/resend/resend-email-sender';
import { resendConfig, type ResendConfig } from './email/resend/resend.config';

/**
 * THE composition point for replaceable external implementations.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §4.
 *
 * **This is the only file in the codebase that names both a port and a
 * vendor.** `grep -rn "resend" src/ --exclude-dir=providers` returns nothing,
 * and that is the whole design: replaceability is a property of the import
 * graph, not of a registry.
 *
 * ## Why a conditional and not a factory class or a registry
 *
 * Exactly one provider is active at a time. A `Map<string, Provider>` would be
 * indirection over a single value; a factory class would be a file and a test
 * standing in for one ternary. Both were considered and rejected in §4 along
 * with failover chains, per-recipient routing and runtime switching — none of
 * which has a requirement. The requirement is REPLACEABILITY, and one
 * conditional delivers it completely.
 *
 * ## Why `useFactory` rather than the literal `useClass` in the frozen sketch
 *
 * `useClass: config.email.provider === 'resend' ? …` needs the configuration
 * value at module-DEFINITION time — before `ConfigModule` has validated
 * anything. `useFactory` injecting the typed namespaces is the same decision
 * taken at the only moment the value exists. The property that matters — one
 * switch, in one file — is intact.
 *
 * Both namespaces are injected rather than read from `process.env`: this file
 * is not exempt from the rule that `env.schema.ts` is the single environment
 * boundary, and a `process.env` lookup here would be untyped, unvalidated and
 * untestable exactly as it would be anywhere else.
 *
 * ## Why `@Global`
 *
 * A port is infrastructure any capability module may need, and the alternative
 * is importing this module into every module that sends anything. Nothing here
 * is a domain concept, so it cannot become hidden coupling between business
 * modules.
 */
@Global()
@Module({
  /**
   * Both namespaces are imported rather than assumed.
   *
   * `emailConfig` is also loaded by the global `ConfigModule`, so injecting it
   * would resolve either way — but a module that depends on a token it does
   * not import is only correct by accident of composition order, and cannot be
   * instantiated on its own. Importing it makes the provider switch testable
   * in isolation, which is what `providers-module.spec.ts` does.
   */
  imports: [
    ConfigModule.forFeature(emailConfig),
    ConfigModule.forFeature(resendConfig),
    ConfigModule.forFeature(brevoConfig),
  ],
  providers: [
    ConsoleEmailSender,
    {
      provide: EmailSenderPort,
      useFactory: (
        email: EmailConfig,
        resend: ResendConfig,
        brevo: BrevoConfig,
        consoleSender: ConsoleEmailSender,
      ): EmailSenderPort => {
        // THE SWITCH. Adding Brevo cost exactly this arm — no business
        // service, template or notification test changed
        // (PROVIDER-ARCHITECTURE.md §5.7).
        //
        // Each vendor adapter is constructed HERE rather than registered as a
        // provider, so the unselected one never comes into existence and never
        // reads a credential. A development or test process that selected
        // `console` holds no vendor client at all.
        switch (email.provider) {
          case 'resend':
            return new ResendEmailSender(resend, email);
          case 'brevo':
            return new BrevoEmailSender(brevo, email);
          default:
            return consoleSender;
        }
      },
      inject: [emailConfig.KEY, resendConfig.KEY, brevoConfig.KEY, ConsoleEmailSender],
    },
  ],
  exports: [EmailSenderPort],
})
export class ProvidersModule {}
