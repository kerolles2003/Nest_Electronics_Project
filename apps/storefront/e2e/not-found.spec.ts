import { expect, test } from './fixtures/browser-health';

/**
 * A dead link answers 404.
 *
 * ## The defect this closes
 *
 * `notFound()` on a route whose body had already begun streaming cannot set a
 * status code, so every dead product, category and brand URL answered **200**.
 * A 200 is a *soft 404*: search engines may index it, analytics counts it as a
 * successful page view, and any monitoring that watches 4xx sees a healthy site
 * while every broken link is quietly served as a success.
 *
 * ## Why the fix was to delete `loading.tsx` files
 *
 * Next gives exactly two remedies: check existence in `proxy.ts` before the body
 * streams, or "ensure the resource exists before the response body is streamed".
 * The proxy is Phase 5b, so the second one — and the body starts streaming "when
 * a Suspense fallback renders (for example, a `loading.tsx`)". Remove the
 * boundaries above the check and the status is the server's to set again.
 *
 * `app/products/loading.tsx` covered `[slug]` as well as the listing, so the
 * listing page moved into a `(listing)` route group. A route group is not a path
 * segment, so `/products` is unchanged and keeps its skeleton while
 * `/products/[slug]` no longer inherits it.
 *
 * ## What this costs, stated rather than hidden
 *
 * The detail routes have **no loading skeleton**. A click on a product shows the
 * previous page until the server responds. Accepted: a correct status on every
 * dead link, against a skeleton on four routes — and reversible, because Phase
 * 5b owns `proxy.ts` and an existence check there would let them all come back.
 *
 * ## What is NOT fixed, and exactly why
 *
 * The 404 body is **empty**. Measured across every combination in Next 16.2.4:
 *
 * ```
 * how notFound() is reached                     status   designed page
 * URL matches no route at all                     404     RENDERED
 * thrown synchronously, before any await          404     RENDERED
 * thrown after an await, no loading.tsx above     404     empty
 * thrown after an await, loading.tsx above        200     empty     <- was here
 * thrown from generateMetadata after an await     404     empty
 * ```
 *
 * A data-driven 404 has to ask the API whether the thing exists, so it always
 * awaits — which is precisely the case Next's own docs warn about: *"Place
 * `notFound()` before those boundaries and before any `await` that may
 * suspend."* There is no in-page arrangement that satisfies both.
 *
 * So this moved every data-driven 404 from the last row to the third: **the
 * status is fixed, the body is not**. The remaining half needs the existence
 * check to move into `proxy.ts`, which is out of scope here.
 *
 * The content assertion below is therefore `test.fail()` — a real assertion that
 * is expected to fail today, and that turns the suite RED the moment it starts
 * passing, so the workaround gets removed rather than outliving the bug.
 */

/** Routes that 404 from their own data — every one of them awaits first. */
const DATA_DRIVEN = [
  { url: '/products/definitely-not-real', label: 'an unknown product' },
  { url: '/categories/does-not-exist-at-all', label: 'an unknown category' },
  { url: '/brands/not-a-real-brand', label: 'an unknown brand' },
];

/** The navigation itself 404s here. That is the point, not a symptom. */
const EXPECTED_404_LOG = /Failed to load resource.*404/;

test('a URL matching no route answers 404 AND renders the designed page', async ({
  page,
  health,
}) => {
  /*
   * The routing-level 404, which has always worked and must keep working. It is
   * also the control for the cases below: it proves `not-found.tsx`, the shared
   * component and the layout are all correct, so a blank body on a data-driven
   * 404 is Next's rendering path and not a broken page of ours.
   */
  health.allowConsoleError(EXPECTED_404_LOG);

  const response = await page.goto('/this-route-does-not-exist');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Homepage' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse Products' })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
});

for (const { url, label } of DATA_DRIVEN) {
  test(`${label} answers 404`, async ({ page, health }) => {
    health.allowConsoleError(EXPECTED_404_LOG);

    const response = await page.goto(url);

    // THE assertion. Every one of these was 200 before.
    expect(response?.status()).toBe(404);

    // Next's own mitigation, still in place and now belt-and-braces with the
    // status: a crawler that ignored the 404 must still not index this.
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);

    // And it is genuinely not serving catalogue content under a 404.
    await expect(page.locator('main a[href^="/products/"]')).toHaveCount(0);
  });

  test(`${label} renders the designed page`, async ({ page, health }) => {
    /*
     * EXPECTED TO FAIL — see the file header for the measurement table.
     *
     * `test.fail()` rather than `test.skip()` deliberately. A skipped test
     * proves nothing and rots quietly; this one runs, asserts the real thing,
     * and Playwright fails the suite if it ever PASSES. That is the signal to
     * delete this block and fold the assertion into the test above.
     */
    test.fail();
    health.allowConsoleError(EXPECTED_404_LOG);

    await page.goto(url);

    await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible({
      timeout: 5_000,
    });
  });
}

test('a live product still answers 200 and renders itself', async ({ page }) => {
  /*
   * The other half of the pair, and not a formality: every assertion above
   * would also pass if the routes had been broken into answering 404
   * unconditionally, which is exactly the shape of mistake a "make it return
   * 404" change invites.
   */
  const response = await page.goto('/products/esp32-devkit-v1');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'ESP32 DevKit V1' })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(0);
});

test('a live category and brand still answer 200', async ({ page }) => {
  const category = await page.goto('/categories/microcontrollers');
  expect(category?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Microcontrollers' })).toBeVisible();

  const brand = await page.goto('/brands/espressif');
  expect(brand?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Espressif' })).toBeVisible();
});

test('the product LISTING keeps its skeleton, and still answers 200', async ({ page }) => {
  /*
   * The route group's reason for existing. `app/products/loading.tsx` covered
   * `[slug]` too, so the listing's skeleton was forcing a 200 on every unknown
   * product. If someone moves it back up a level, the unknown-product
   * assertions above start failing and this test explains why.
   */
  const response = await page.goto('/products');

  expect(response?.status()).toBe(200);
  await expect(page.getByText('34 products found')).toBeVisible();
});
