import { z } from 'zod';

/**
 * THE SINGLE ENVIRONMENT BOUNDARY.
 *
 * ConfigModule performs the raw read and hands the merged environment to
 * `validateEnv` below; no other file in this codebase touches `process.env`
 * at all. Everywhere else, configuration arrives through typed injection. A
 * `process.env.X` in a service is three problems at once: untyped
 * (`string | undefined`), unvalidated (a typo yields `undefined` at 3 a.m.
 * rather than at boot), and untestable (overriding it means mutating global
 * state).
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §1, §3.
 *
 * The legacy precedent this exists to avoid: `packages/config/src/env.ts`
 * implemented exactly this fail-fast validation and was imported by NOTHING,
 * so it never ran. Here the schema executes inside ConfigModule at boot and
 * the process cannot start without it.
 */

/** Environment variables are strings; accept the usual spellings of a boolean. */
const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * A token lifetime such as `15m` or `30d`.
 *
 * Validated as a shape here so a typo like `15min` fails at boot rather than
 * producing a token that expires at an unintended moment — jsonwebtoken would
 * silently accept some malformed values.
 */
const durationString = z
  .string()
  .regex(/^[1-9][0-9]*[smhd]$/, { message: 'Must be a duration like 15m, 24h or 30d' });

/**
 * Keys whose validation message must never echo the supplied value.
 * Zod's default enum/string messages can include `received '…'`, which would
 * put a secret into a log line.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §6 — secrets are
 * never logged.
 */
/**
 * The default envelope sender: a deliberate, unmistakable placeholder.
 *
 * `.invalid` is reserved by RFC 2606 and is guaranteed never to resolve, so
 * this address cannot deliver mail to anyone under any circumstances. That is
 * the point — the previous default was Resend's shared sandbox sender
 * `onboarding@resend.dev`, which is a REAL, deliverable address belonging to
 * one vendor. Carrying it as the default meant a deployment that forgot to set
 * a sender inherited a Resend identity while `EMAIL_PROVIDER` said `brevo`
 * (F-02) — a mismatch that fails even with a valid key, because a domain
 * verified with one vendor is not verified with another.
 *
 * A placeholder that cannot possibly work is safer than a real one that works
 * only in the wrong circumstances. The production guard in the superRefine
 * below refuses it outright, so this value can never reach a live deployment.
 *
 * The owner's real sender lands with the Brevo production line (Phase E),
 * together with the SPF/DKIM records that authorise it. No domain is invented
 * here.
 */
const PLACEHOLDER_SENDER = 'no-reply@nest-electronics.invalid';

const SECRET_KEYS: ReadonlySet<string> = new Set([
  'MONGODB_URI',
  'RESEND_API_KEY',
  'BREVO_API_KEY',
  'JWT_SECRET',
]);

/**
 * A value that was never meant to be used — the shape `.env.example` ships.
 *
 * Anchored, so a real key that merely happens to contain the word is not
 * refused. Exported because `test/config/env-example.spec.ts` asserts that the
 * example file's own value matches it: the example must stay unusable, and that
 * is a property worth failing a build over rather than trusting to review.
 */
export const PLACEHOLDER_SECRET = /^REPLACE_/i;

export const envSchema = z.object({
  // ---- Application ----
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  API_PREFIX: z.string().min(1).default('api'),

  /**
   * Absent means "follow the frozen rule": Swagger is a non-production surface.
   * Normalised in app.config.ts so the default is computed once.
   */
  SWAGGER_ENABLED: booleanFromString.optional(),

  /**
   * Public origin of the STOREFRONT, used to build links a customer clicks
   * from an email — the verification link and the order link.
   *
   * Not the API's own origin: nothing in an email points at the API. A wrong
   * value produces emails whose links 404, so it is validated as a real
   * absolute URL, and the trailing slash is normalised away once here rather
   * than defended against at every concatenation site.
   */
  SITE_URL: z
    .string()
    .url({ message: 'Must be an absolute URL such as https://nestelectronics.com' })
    .default('http://localhost:3000')
    .transform((value) => value.replace(/\/+$/, '')),

  /**
   * Comma-separated browser origins allowed to call this API with credentials.
   *
   * An ALLOW-LIST, never a wildcard: API-STANDARDS.md §6 freezes
   * `credentials: true`, and the Fetch spec forbids pairing that with `*` — so
   * a wildcard here would not merely be lax, it would break every
   * authenticated browser call. Empty (the default) allows no browser origin,
   * which is correct for the current server-to-server topology and fails
   * closed rather than open.
   */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter((origin) => origin.length > 0),
    ),

  // ---- Database ----
  /**
   * Connection string. REQUIRED and deliberately WITHOUT a default: it is a
   * secret, and "defaulting a secret is a weak default that silently reaches
   * production" (CONFIGURATION-ARCHITECTURE.md §11).
   *
   * The shape is checked here so an obviously wrong value is rejected at boot
   * rather than becoming a cryptic driver error 30 seconds into startup. This
   * validates the FORM only — reachability is the connection's job.
   */
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((value) => /^mongodb(\+srv)?:\/\/\S+$/.test(value), {
      // Deliberately describes the expected shape without echoing the value.
      message: 'Must be a mongodb:// or mongodb+srv:// connection string',
    }),

  // ---- Authentication ----
  /**
   * HS256 signing key for access tokens. REQUIRED, no default: a defaulted
   * signing key is a forged-token vulnerability that reaches production
   * silently. Minimum 32 characters is a frozen requirement
   * (CONFIGURATION-ARCHITECTURE.md §11) — below that the key is brute-forceable
   * offline from a single captured token.
   *
   * ## And the placeholder is refused, for exactly the same reason
   *
   * `.env.example` ships `JWT_SECRET=REPLACE_WITH_...`, which is **57
   * characters** and therefore passed the length rule. `cp .env.example .env`
   * and the API booted, seeded and served tokens signed with a key that is in
   * the repository — identical on every machine that skipped the step, and
   * readable by anyone who can read the source.
   *
   * "No default, deliberately" was true of the schema and false of the
   * workflow: a placeholder nothing rejects IS a default. Found by following
   * `docs/api/SANDBOX.md` literally on a clean clone, which is the only way to
   * notice a step that everybody who already knows it never skips.
   *
   * Matched on the `REPLACE_` prefix rather than the exact string, so a future
   * placeholder written in the same style is refused too.
   */
  JWT_SECRET: z
    .string()
    .min(32, { message: 'Must be at least 32 characters' })
    .refine((value) => value.trim().length >= 32, {
      message: 'Must be at least 32 characters',
    })
    .refine((value) => !PLACEHOLDER_SECRET.test(value.trim()), {
      message:
        'Still set to the .env.example placeholder. Generate one: ' +
        'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))" ' +
        'and put it in apps/api/.env',
    }),

  /** Access-token lifetime. Short by design: access tokens are NOT revocable. */
  JWT_ACCESS_TTL: durationString.default('15m'),

  /** Refresh-token lifetime. Long, but revocable and rotated on every use. */
  JWT_REFRESH_TTL: durationString.default('30d'),

  /**
   * bcrypt cost factor. 12 is the frozen value (AUTHORIZATION-MODEL.md §2.2).
   * Bounded below at 10 so a misconfiguration cannot silently weaken hashing,
   * and above at 15 so it cannot silently turn login into a timeout.
   */
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  /**
   * Whether an unverified account may log in.
   *
   * The frozen posture is that verification is REQUIRED (AUTHORIZATION-MODEL.md
   * §2.5). Delivery belongs to NotificationsModule, which does not exist yet, so
   * development needs to be able to log in. The superRefine below makes it
   * impossible to disable this in production — the escape hatch cannot escape.
   */
  AUTH_REQUIRE_EMAIL_VERIFICATION: booleanFromString.default('true'),

  /**
   * Relaxes every rate limit by a fixed multiplier. **Test environments only.**
   *
   * The limits themselves stay where they are, declared per route. This only
   * moves the ceiling so a browser suite can create the accounts it needs
   * without failing on a throttle that has nothing to do with the code under
   * test. `throttle.config.ts` holds the multiplier and the reasoning; the
   * superRefine below makes this impossible to set in production.
   *
   * The guard is still tested against the REAL numbers — jest pins this to
   * false for every suite (`test/setup/production-like-limits.ts`) and
   * `test/auth/auth-guards.spec.ts` asserts the pin before asserting the 429.
   */
  RATE_LIMIT_RELAXED: booleanFromString.default('false'),

  // ---- Fulfilment (shipping cost policy) ----

  /**
   * Order value in integer MINOR UNITS at or above which delivery is free.
   *
   * Absent means "no threshold". Compared against the POST-DISCOUNT subtotal
   * (MONEY-MODEL.md §7.1). Implemented and deliberately unset.
   *
   * `SHIPPING_FLAT_FEE` used to sit above this. It was OPEN-001's specified
   * fallback while the per-governorate rates were unsupplied business input;
   * D-8 supplied them, so the fee now comes from the `shippingRates`
   * collection (`pnpm --filter api shipping:seed`) and the variable is gone
   * rather than deprecated. A knob that is read by nothing is worse than an
   * absent one: someone sets it, nothing happens, and nothing says why.
   *
   * There is deliberately no per-governorate override: one threshold, global,
   * from configuration. A row-level threshold was written and then removed —
   * see the note on `shipping-rate.schema.ts` for why an undocumented
   * precedence rule is worse than an absent feature.
   */
  FREE_SHIPPING_THRESHOLD: z.coerce.number().int().min(0).optional(),

  // ---- Email provider selection (application level) ----
  // Selection only. NO SDK is initialised in this phase, and no business code
  // may ever branch on this value.
  // Authority: CONFIGURATION-ARCHITECTURE.md §5; PROVIDER-ARCHITECTURE.md §5.5.
  EMAIL_PROVIDER: z.enum(['console', 'resend', 'brevo']).default('console'),

  /**
   * The envelope sender. Provider-agnostic and application-level: the ADAPTER
   * reads it, so no business code can ever choose a from-address, and a
   * provider swap does not move it.
   *
   * In production this must be an address at a domain whose SPF/DKIM records
   * authorise the provider. That is a DNS fact this schema cannot check, so it
   * validates the shape and the deployment checklist owns the rest.
   */
  EMAIL_FROM_ADDRESS: z.string().email().default(PLACEHOLDER_SENDER),

  /** Display name shown beside the from-address in a mail client. */
  EMAIL_FROM_NAME: z.string().min(1).default('Nest Electronics'),

  /**
   * Where a customer's reply goes. Absent means replies go to the
   * from-address, which for a no-reply sender means they vanish — so setting
   * this is strongly advised in production but not forced, because a team
   * without a support inbox yet should not be blocked from deploying.
   */
  EMAIL_REPLY_TO: z.string().email().optional(),

  // ---- Email provider credentials (vendor level) ----
  // Conditionally required — see the superRefine below. Deliberately NOT
  // exposed through any application-level namespace: when the Resend adapter
  // exists it reads this through its own vendor config, and nothing else does.
  RESEND_API_KEY: z.string().min(1).optional(),

  /**
   * The prefix every managed asset lives under (MEDIA-MODEL.md §6).
   *
   * Default `nest`, which is what production uses. It is configurable because
   * **the Cloudinary account is shared** — it already holds 108 assets from an
   * unrelated application under `partners/` and `users/avatars/` — so a second
   * environment pointing at the same cloud would otherwise write into the same
   * folder as the first, and the orphan reconciliation report would then see
   * one environment's assets as the other's orphans.
   *
   * Constrained to path-safe characters and no leading or trailing slash,
   * because it is concatenated into a `publicId`. A value containing `..`
   * would be a path-traversal question in somebody else's storage.
   */
  MEDIA_FOLDER_ROOT: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9/_-]*[a-z0-9]$/,
      'MEDIA_FOLDER_ROOT must be lowercase path-safe characters, with no leading or trailing slash',
    )
    .refine((value) => !value.includes('..'), 'MEDIA_FOLDER_ROOT must not contain ".."')
    .default('nest'),

  /**
   * Brevo (formerly Sendinblue). Required ONLY when `EMAIL_PROVIDER=brevo`.
   *
   * Read exclusively through `providers/email/brevo/brevo.config.ts`; no
   * application-level namespace exposes it, so nothing outside that adapter
   * can reach it.
   */
  BREVO_API_KEY: z.string().min(1).optional(),

  // ---- Media provider selection (application level) ----
  // Authority: CONFIGURATION-ARCHITECTURE.md §9 (names), MEDIA-MODEL.md §12.
  //
  // `memory` is the media counterpart of `EMAIL_PROVIDER=console`: it accepts
  // and validates every byte exactly as the real adapter does, then keeps the
  // result in process instead of sending it to a vendor. It exists so the whole
  // upload pipeline — authorization, size, MIME, magic bytes, EXIF stripping,
  // dimension capture, publicId generation — is exercised on a machine with no
  // Cloudinary account, which today is every machine (D-4 credentials are not
  // yet supplied).
  MEDIA_PROVIDER: z.enum(['memory', 'cloudinary']).default('memory'),

  // ---- Media provider credentials (vendor level) ----
  // All three are required together when `MEDIA_PROVIDER=cloudinary`, and are
  // read ONLY through providers/media/cloudinary/cloudinary.config.ts.
  //
  // CLOUDINARY_CLOUD_NAME is a public identifier and appears in every delivery
  // URL; the other two are secrets and must never be exposed to a browser
  // (MEDIA-MODEL.md §12 — "Never NEXT_PUBLIC_*").
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
});

/**
 * Vendor credentials are required ONLY when their provider is selected.
 * Choosing `console` in development must not demand a Resend key.
 *
 * Authority: CONFIGURATION-ARCHITECTURE.md §5 — "Conditional validation".
 */
const envSchemaWithConditionals = envSchema.superRefine((value, ctx) => {
  // Email verification is a production security control, not a preference.
  if (value.NODE_ENV === 'production' && !value.AUTH_REQUIRE_EMAIL_VERIFICATION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AUTH_REQUIRE_EMAIL_VERIFICATION'],
      message: "Must be true when NODE_ENV='production'",
    });
  }

  // Rate limiting is a production security control, not a preference. Same
  // shape as the rule above it, and for the same reason.
  if (value.NODE_ENV === 'production' && value.RATE_LIMIT_RELAXED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RATE_LIMIT_RELAXED'],
      message: "Must be false when NODE_ENV='production'",
    });
  }

  if (value.EMAIL_PROVIDER === 'resend' && value.RESEND_API_KEY === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RESEND_API_KEY'],
      message: "Required when EMAIL_PROVIDER='resend'",
    });
  }

  if (value.EMAIL_PROVIDER === 'brevo' && value.BREVO_API_KEY === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['BREVO_API_KEY'],
      message: "Required when EMAIL_PROVIDER='brevo'",
    });
  }

  // All three Cloudinary values or none. A partial set is the dangerous case:
  // the SDK would construct, then fail at the first upload with an
  // authentication error that reads like an outage rather than like the
  // configuration mistake it is.
  for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const) {
    if (value.MEDIA_PROVIDER === 'cloudinary' && value[key] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "Required when MEDIA_PROVIDER='cloudinary'",
      });
    }
  }

  // The memory adapter keeps uploads in process memory. In production that is
  // not a degraded mode but a data-loss one: an admin uploads a product image,
  // the API reports success, and the bytes vanish at the next restart while
  // the database keeps a reference to an asset that no longer exists. Refused
  // for the same reason as EMAIL_PROVIDER=console below.
  if (value.NODE_ENV === 'production' && value.MEDIA_PROVIDER === 'memory') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MEDIA_PROVIDER'],
      message:
        "Must not be 'memory' when NODE_ENV='production' — uploads would be lost at restart",
    });
  }

  // The console adapter prints to stdout instead of sending. In production
  // that is not a degraded mode, it is a BROKEN one: verification is mandatory
  // in production (the rule above), so every account created would be
  // permanently unable to sign in while the API reported success. Refusing to
  // boot is the only honest behaviour.
  if (value.NODE_ENV === 'production' && value.EMAIL_PROVIDER === 'console') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EMAIL_PROVIDER'],
      message: "Must not be 'console' when NODE_ENV='production' — no mail would be delivered",
    });
  }

  // The placeholder sender is unroutable by construction (RFC 2606 `.invalid`).
  // Reaching production with it means every verification and order email is
  // rejected by the first relay that resolves the domain — the same class of
  // silent, total failure the console-provider guard above prevents, so it is
  // refused the same way rather than left to a deployment checklist.
  if (value.NODE_ENV === 'production' && value.EMAIL_FROM_ADDRESS === PLACEHOLDER_SENDER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EMAIL_FROM_ADDRESS'],
      message:
        "Must be a real sender on a domain verified with the selected provider when " +
        "NODE_ENV='production' — the default placeholder cannot deliver",
    });
  }

  // A localhost site URL in production yields verification links that only
  // resolve on the deployer's own laptop.
  if (value.NODE_ENV === 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(value.SITE_URL)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SITE_URL'],
      message: "Must be the public storefront origin when NODE_ENV='production', not localhost",
    });
  }
});

export type Env = Readonly<z.infer<typeof envSchema>>;

/** Formats issues as `KEY  message`, redacting any message that could echo a secret. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    const message = SECRET_KEYS.has(key) ? 'Invalid or missing value' : issue.message;
    return `${key.padEnd(20)} ${message}`;
  });
}

/**
 * Treats an empty environment variable as absent, so schema defaults apply.
 *
 * `PORT=` in a compose file, a CI secret that resolves to empty, or a bare
 * `LOG_LEVEL=` line in a .env file all arrive as `''`. Every deployment
 * platform treats those as "not set"; Zod's `.default()` only fires on
 * `undefined`, so without this an empty value becomes a confusing boot failure
 * instead of the intended default.
 */
function stripEmpty(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
}

let validated: Env | undefined;

/**
 * Parses and validates the environment. Reports EVERY problem at once — a
 * developer setting up the project should see all missing variables in one
 * run, not discover them one restart at a time — then exits.
 *
 * Wired as ConfigModule's `validate`, so it runs before any config factory.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchemaWithConditionals.safeParse(stripEmpty(raw));

  if (!result.success) {
    const issues = formatIssues(result.error);
    // Written directly to stderr: the Nest logger is not yet constructed, and
    // this must be readable even when nothing else has started.
    process.stderr.write(`\n✖ Configuration invalid — ${String(issues.length)} problem(s):\n`);
    for (const issue of issues) {
      process.stderr.write(`  ${issue}\n`);
    }
    process.stderr.write('\nSee apps/api/.env.example for the full variable set.\n\n');
    process.exit(1);
  }

  validated = Object.freeze(result.data);
  return validated;
}

/**
 * The validated environment, for config factories only.
 * Throws rather than returning undefined if reached before validation — a
 * loud failure beats a silently empty configuration.
 */
export function env(): Env {
  if (validated === undefined) {
    throw new Error('Configuration accessed before validateEnv() ran. Import ConfigModule first.');
  }
  return validated;
}
