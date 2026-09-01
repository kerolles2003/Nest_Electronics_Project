/**
 * F-07 — provider isolation for the whole jest run.
 *
 * Registered as a jest `setupFiles` entry, so it executes BEFORE the test file
 * and its imports are evaluated — which is the only moment early enough to
 * influence `ConfigModule`, since `validateEnv` reads the environment the
 * first time a module graph is compiled.
 *
 * ## The failure this closes
 *
 * `apps/api/.env` pairs `EMAIL_PROVIDER=brevo` with a real key. Nine suites
 * build the real `AppModule` and register real users, and registration sends a
 * verification email — so a full run made **225 live vendor calls**. Today
 * those calls fail (`401 Key not found`) and email failure is non-fatal by
 * design, which is exactly what makes this dangerous: the suite is green, so
 * nothing announces that the moment a VALID key exists the same run starts
 * delivering real mail to real addresses.
 *
 * `email-integration.spec.ts` was already safe — it overrides
 * `EmailSenderPort` with a recorder — and `brevo-adapter.spec.ts` stubs
 * `fetch`. This file covers the other nine, and does so centrally rather than
 * by editing every `createTestingModule` call, so a NEW suite is isolated by
 * default instead of by remembering.
 *
 * ## Two independent guarantees, either one sufficient
 *
 * 1. **Selection** — `EMAIL_PROVIDER=console` is forced. `ProvidersModule`'s
 *    switch therefore constructs `ConsoleEmailSender`, and the vendor adapters
 *    are never constructed at all, so no key is ever read
 *    (PROVIDER-ARCHITECTURE.md §4).
 * 2. **Transport** — any `fetch` to a known mail-vendor host throws. This is
 *    the belt to the braces: it converts a future regression (someone
 *    re-selects a vendor, or an adapter is constructed by a new code path)
 *    from a silent send into a loud, immediate test failure.
 *
 * Guarantee 2 is deliberately narrow. It matches vendor hosts only — MongoDB
 * speaks its own wire protocol over a socket, not `fetch`, so nothing legitimate
 * is intercepted. Suites that stub `globalThis.fetch` themselves (the adapter
 * unit tests) simply shadow this guard for their duration and restore it after.
 *
 * Authority: docs/architecture/PROVIDER-ARCHITECTURE.md §3, §4;
 *            docs/architecture/TESTING-ARCHITECTURE.md.
 */

/**
 * Forced, not defaulted.
 *
 * `ConfigModule` is configured so real process env wins over `.env` file
 * values, so assigning here overrides whatever the developer's `.env` says.
 * A test run must never inherit the machine's mail configuration.
 */
process.env.EMAIL_PROVIDER = 'console';

/**
 * Vendor keys are deliberately NOT deleted here, and it is worth recording why
 * the obvious move does not work.
 *
 * `@nestjs/config`'s `forRoot()` executes when `config.module.ts` is imported,
 * and it loads `.env` into `process.env` at that moment. Anything deleted in
 * this file is therefore restored the first time the config module is imported
 * — measured, not assumed. A `delete` here would read as a protection while
 * providing none, which is worse than not having it.
 *
 * Isolation consequently does not depend on the key being absent. It depends on
 * the provider never being selected (above) and on the transport being blocked
 * (below), neither of which `.env` can undo.
 */

/**
 * Hosts that would receive real mail. Matched on hostname, so a path or query
 * change in a vendor's API cannot slip past.
 */
export const BLOCKED_EMAIL_VENDOR_HOSTS: readonly string[] = [
  'api.brevo.com',
  'api.sendinblue.com',
  'api.resend.com',
  'api.sendgrid.com',
  'api.mailgun.net',
];

function hostnameOf(input: unknown): string | null {
  try {
    if (typeof input === 'string') return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input !== null && typeof input === 'object' && 'url' in input) {
      const { url } = input as { url: unknown };
      if (typeof url === 'string') return new URL(url).hostname;
    }
  } catch {
    // Not a parseable absolute URL — it cannot be a vendor call.
    return null;
  }
  return null;
}

const realFetch = globalThis.fetch;

globalThis.fetch = function guardedFetch(
  ...args: Parameters<typeof realFetch>
): ReturnType<typeof realFetch> {
  const hostname = hostnameOf(args[0]);

  if (hostname !== null && BLOCKED_EMAIL_VENDOR_HOSTS.includes(hostname)) {
    throw new Error(
      `F-07 guard: the test suite attempted a live email-vendor call to ${hostname}. ` +
        'Tests must never reach a mail provider. Override EmailSenderPort in the suite, ' +
        'or stub fetch, rather than removing this guard.',
    );
  }

  return realFetch(...args);
} as typeof realFetch;
