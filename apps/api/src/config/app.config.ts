import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * Application runtime configuration.
 *
 * Derivation happens HERE, once, not in a consumer's constructor.
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §4, §11.
 */
export const appConfig = registerAs('app', () => {
  const e = env();

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    apiPrefix: e.API_PREFIX,

    /**
     * Absent SWAGGER_ENABLED follows the frozen rule that Swagger is a
     * non-production surface — which is exactly the Phase 2.2 behaviour, so
     * the default is a no-op refactor. An explicit value overrides it.
     * Authority: CONFIGURATION-ARCHITECTURE.md §7, §8.
     */
    swaggerEnabled: e.SWAGGER_ENABLED ?? e.NODE_ENV !== 'production',

    /**
     * Public storefront origin, already stripped of a trailing slash by the
     * schema. Consumers concatenate a path onto it directly.
     */
    siteUrl: e.SITE_URL,

    /**
     * Browser origins permitted to send credentialed requests. Frozen as an
     * allow-list (API-STANDARDS.md §6); an empty array allows none.
     */
    corsOrigins: e.CORS_ORIGINS,
  } as const;
});

export type AppConfig = ConfigType<typeof appConfig>;
