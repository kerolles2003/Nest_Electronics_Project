import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { databaseConfig } from './database.config';
import { emailConfig } from './email.config';
import { fulfilmentConfig } from './fulfilment.config';
import { validateEnv } from './env.schema';

/**
 * The configuration boundary.
 *
 * Environment input → validation → typed normalised namespaces → consumers.
 * `validate` runs before any factory in `load`, so `env()` is always populated
 * by the time a namespace is built.
 *
 * Global because configuration is genuinely cross-cutting; modules still
 * inject only the namespaces they need, never a god object.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §3, §4.
 *
 * Namespaces deferred to the phases that consume them: `media`, `throttle`,
 * `observability`. Each is one schema block plus one `registerAs` file.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      load: [appConfig, authConfig, databaseConfig, emailConfig, fulfilmentConfig],
      // Local development only. Production supplies variables through the
      // platform secret store; no .env file exists on a production host.
      // Real process env always wins over file values.
      envFilePath: ['.env.local', '.env'],
    }),
  ],
})
export class ConfigModule {}
