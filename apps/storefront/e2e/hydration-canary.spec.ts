import { expect, test, HYDRATION_CANARY_PATH, probeHydration } from './fixtures/browser-health';

/**
 * The canary's own test. **This is the one that matters.**
 *
 * Every other spec in this directory depends on a browser that is actually
 * running the application. For the whole of phases 1 to 5a it was not: `next
 * dev` refuses cross-origin requests for `/_next/*`, it treats `127.0.0.1` and
 * `localhost` as different origins, and the suite drove one while the dev
 * server called itself the other. Every client chunk was refused. React never
 * booted on any page, in any test, ever — and 44 tests passed, because pages
 * server-render and forms submit by progressive enhancement.
 *
 * The origin is pinned now (one HOST constant in `playwright.config.ts`, used
 * for the tests' base URL, for `next dev --hostname` and for
 * `allowedDevOrigins`). But **a fix is not a protection**. The protection is
 * the canary in the health fixture, which asserts React mounted before every
 * spec's body runs — and a canary nobody has watched die is just a bird.
 *
 * So this file kills it deliberately. The blocked-chunks case below produces
 * exactly the state the whole engagement was in, and asserts the probe reports
 * it. If the detector ever stops detecting — React renames its internals, the
 * markers move, someone weakens the check — this goes red instead of the suite
 * going quiet.
 *
 * Both cases use their OWN browser context, so the fixture's canary on `page`
 * is not what is being measured; it is the probe itself under test.
 */

/** Everything `next dev` serves that carries client JavaScript. */
const CLIENT_CHUNKS = '**/_next/**';

test.describe('the hydration canary', () => {
  test('reports a LIVE client on a page the application actually runs on', async ({ browser }) => {
    const context = await browser.newContext();
    const probePage = await context.newPage();

    try {
      await probePage.goto(
        `${test.info().project.use.baseURL ?? ''}${HYDRATION_CANARY_PATH}`,
      );

      /*
       * Polled, not read once: hydration happens after `load`, and on a cold
       * dev route the client chunks are compiled on demand.
       */
      await expect
        .poll(() => probePage.evaluate(probeHydration), { timeout: 30_000 })
        .toEqual({ hydrated: true, clientRuntimeLoaded: true });
    } finally {
      await context.close();
    }
  });

  test('reports a DEAD client when the browser cannot load /_next/*', async ({ browser }) => {
    const context = await browser.newContext();
    const probePage = await context.newPage();

    /*
     * The reproduction. Aborting these requests is what the dev server's
     * cross-origin refusal did to every page for months — same effect, one
     * line, and it does not need a misconfigured server to demonstrate.
     */
    await context.route(CLIENT_CHUNKS, (route) => route.abort());

    try {
      await probePage.goto(
        `${test.info().project.use.baseURL ?? ''}${HYDRATION_CANARY_PATH}`,
        // `load` never fires cleanly when subresources are aborted.
        { waitUntil: 'domcontentloaded' },
      );

      // The page still LOOKS fine — which is the entire problem. The server
      // rendered it, and an assertion on its content would pass.
      await expect(probePage.locator('body')).not.toBeEmpty();

      /*
       * Given far longer than the real canary allows, so this cannot pass by
       * simply being quick to give up.
       */
      await probePage.waitForTimeout(3_000);

      const probe = await probePage.evaluate(probeHydration);

      expect(probe.hydrated).toBe(false);
      expect(probe.clientRuntimeLoaded).toBe(false);
    } finally {
      await context.close();
    }
  });
});
