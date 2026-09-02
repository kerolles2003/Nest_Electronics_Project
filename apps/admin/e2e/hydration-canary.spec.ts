import { expect, test, HYDRATION_CANARY_PATH, probeHydration } from './fixtures/browser-health';
import { BASE_URL } from './origin';

/**
 * The canary's own test. **This is the one that matters.**
 *
 * Every other spec in this directory will depend on a browser that is actually
 * running the admin application. In the storefront it was not, for the whole of
 * phases 1 to 5a: `next dev` refuses cross-origin requests for `/_next/*`, it
 * treats `127.0.0.1` and `localhost` as different origins, and the suite drove
 * one while the dev server called itself the other. Every client chunk was
 * refused. React never booted on any page, in any test, ever — and 44 tests
 * passed, because pages server-render and forms submit by progressive
 * enhancement.
 *
 * The origin is pinned here from the start (one HOST constant in `origin.ts`,
 * used for the tests' base URL, for `next dev --hostname` and for
 * `allowedDevOrigins`). But **a fix is not a protection**. The protection is
 * the canary in the health fixture, which asserts React mounted before every
 * spec's body runs — and a canary nobody has watched die is just a bird.
 *
 * So this file kills it deliberately. The blocked-chunks case below produces
 * exactly the state the storefront was in, and asserts the probe reports it. If
 * the detector ever stops detecting — React renames its internals, the markers
 * move, someone weakens the check — this goes red instead of the admin suite
 * going quiet.
 *
 * ## What was actually measured, and what was not
 *
 * The canary was verified by ABORTING the chunks, not by reproducing a
 * cross-origin refusal. Reproducing one on Next 16.2.4 was attempted and did
 * not work: `127.0.0.1` and `localhost` are different origins to the dev
 * server's allow-list, but they are the SAME origin to the browser once the
 * page is being served from one of them — the chunk request is same-origin
 * whatever address the server bound to — so `allowedDevOrigins: ['…invalid']`
 * with the tests driving the bound host still hydrated cleanly.
 *
 * That is worth stating plainly rather than implying a proof that was not
 * obtained. Two things follow, and both are why this file is shaped the way it
 * is:
 *
 *  - The origin pin in `origin.ts` stays. It costs nothing, the storefront
 *    demonstrably hit this, and a Next release can tighten the rule again.
 *  - The canary does not depend on that mechanism at all. It asserts the
 *    OUTCOME — no React root — so it catches a dead client from any cause: a
 *    refused origin, a 404 on the asset prefix, a basePath change, a proxy rule
 *    that swallows `/admin/_next/*`, or a hydration error thrown by the
 *    application. Checking the outcome rather than the mechanism is the check
 *    that cannot be fooled by a mechanism changing.
 *
 * Both cases use their OWN browser context, so the fixture's canary on `page`
 * is not what is being measured; it is the probe itself under test.
 */

/**
 * Everything `next dev` serves that carries client JavaScript.
 *
 * The glob is deliberately loose about the prefix. This app has
 * `basePath: '/admin'`, so its chunks are at `/admin/_next/*` — and a pattern
 * written as `/_next/**` would match nothing here and the test would pass by
 * blocking no requests at all, which is the single most likely way for this
 * file to become decorative.
 */
const CLIENT_CHUNKS = '**/_next/**';

test.describe('the hydration canary', () => {
  test('reports a LIVE client on a page the admin application actually runs on', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const probePage = await context.newPage();

    try {
      await probePage.goto(`${BASE_URL}${HYDRATION_CANARY_PATH}`);

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

  test('reports a DEAD client when the browser cannot load the chunks', async ({ browser }) => {
    const context = await browser.newContext();
    const probePage = await context.newPage();

    /*
     * The reproduction. Aborting these requests is what the dev server's
     * cross-origin refusal did to every page for five phases — same effect, one
     * line, and it does not need a misconfigured server to demonstrate.
     */
    let aborted = 0;

    await context.route(CLIENT_CHUNKS, (route) => {
      aborted += 1;
      return route.abort();
    });

    try {
      await probePage.goto(
        `${BASE_URL}${HYDRATION_CANARY_PATH}`,
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

      /*
       * The check on the check. If the glob stopped matching — a basePath
       * change, a Next release that moves the asset prefix — nothing would be
       * blocked, the page would hydrate normally, and the two assertions above
       * would fail in a way that reads like a broken app. Asserting that
       * requests were actually aborted is what makes this test say "the
       * reproduction did not reproduce" instead.
       */
      expect(aborted).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('distinguishes a DEAD client from a merely slow one', async ({ browser }) => {
    /*
     * The failure this rules out is the canary passing for the wrong reason:
     * a probe that only ever reported `false` would satisfy the blocked case
     * above and would fail every real spec. The live case at the top covers
     * that, but only on a warm route.
     *
     * Here the chunks are DELAYED rather than blocked, so the page starts dead
     * and becomes alive. A probe that latched either way fails this.
     */
    const context = await browser.newContext();
    const probePage = await context.newPage();

    await context.route(CLIENT_CHUNKS, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.continue();
    });

    try {
      await probePage.goto(`${BASE_URL}${HYDRATION_CANARY_PATH}`, {
        waitUntil: 'domcontentloaded',
      });

      await expect
        .poll(() => probePage.evaluate(probeHydration), { timeout: 30_000 })
        .toEqual({ hydrated: true, clientRuntimeLoaded: true });
    } finally {
      await context.close();
    }
  });
});
