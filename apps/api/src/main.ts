import "reflect-metadata";
import { Logger, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { buildOpenApiDocumentConfig } from "./openapi/openapi.document";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { appConfig, type AppConfig } from "./config/app.config";

/**
 * Bootstrap only — no business logic, no conditional feature logic.
 * Authority: docs/architecture/CODEBASE-STRUCTURE.md §2.1.
 */

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Typed, validated configuration. Nothing below parses an environment string.
  const config = app.get<AppConfig>(appConfig.KEY);

  // API returns only JSON, so the CSP is maximally restrictive.
  // Authority: docs/architecture/API-STANDARDS.md §6.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "frame-ancestors": ["'none'"],
        },
      },
      // Helmet 8 defaults to SAMEORIGIN / no-referrer; the frozen table
      // requires DENY and strict-origin-when-cross-origin.
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    }),
  );

  /**
   * CORS — an explicit allow-list, never a wildcard.
   * Authority: docs/architecture/API-STANDARDS.md §6.
   *
   * `credentials: true` and `origin: '*'` are mutually exclusive in the Fetch
   * spec: a browser refuses a credentialed response whose
   * `Access-Control-Allow-Origin` is a wildcard. So a wildcard here would not
   * merely be lax — it would BREAK every authenticated browser call while
   * appearing to work for public ones. The allow-list is the only correct
   * option, not the strict one.
   *
   * An empty list disables cross-origin browser access entirely, which is the
   * correct default and the current topology: the storefront calls this API
   * from its Next.js SERVER, where CORS does not apply. This matters for the
   * deployment — see docs/deployment/DEPLOYMENT-DECISION.md §5. It becomes
   * load-bearing the moment a browser calls the API directly, and failing
   * closed until then is what keeps an unreviewed origin from being trusted.
   *
   * Flutter is not subject to CORS and must not be used as a reason to widen
   * this.
   */
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    // Both are REQUEST headers this API requires: without them a browser
    // pre-flight rejects the very calls the allow-list exists to permit.
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Accept-Language",
      "Idempotency-Key",
    ],
    // So a browser client can read the correlation id it needs to quote in a
    // bug report. Response headers are invisible to script unless exposed.
    exposedHeaders: ["X-Request-Id"],
    maxAge: 600,
  });

  // Base path /api/v1 — URI path versioning, v1 from day one.
  // Authority: docs/architecture/API-CONTRACT.md §1.
  app.setGlobalPrefix(config.apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  // Releases resources deterministically on SIGTERM/SIGINT. Nothing owns a
  // resource yet; this is the generic foundation the future MongoDB connection
  // and provider clients hook into via onModuleDestroy.
  app.enableShutdownHooks();

  // The OpenAPI document is generated from the same decorators that perform
  // runtime validation, so documentation cannot drift from behaviour.
  // Authority: docs/architecture/API-CONTRACT.md §8.
  // SWAGGER_ENABLED, defaulting to "non-production only" — the same behaviour
  // as before, now explicit and overridable.
  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      buildOpenApiDocumentConfig(config.port),
    );

    SwaggerModule.setup(`${config.apiPrefix}/v1/docs`, app, document, {
      jsonDocumentUrl: `${config.apiPrefix}/v1/docs-json`,
      swaggerOptions: { docExpansion: "list", tryItOutEnabled: true },
    });
  }

  await app.listen(config.port);

  // The configuration SHAPE, never values — enough to answer "what is live?".
  // Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §6.
  new Logger("Bootstrap").log(
    `config loaded  env=${config.nodeEnv}  port=${String(config.port)}  ` +
      `prefix=/${config.apiPrefix}/v1  swagger=${String(config.swaggerEnabled)}  ` +
      // COUNT, not the origins themselves: a deployment log is read by more
      // people than the allow-list is, and "how many" is what answers "did my
      // configuration land?".
      `corsOrigins=${String(config.corsOrigins.length)}  site=${config.siteUrl}`,
  );
}

void bootstrap();
