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
 * ## The body was never broken — the test harness was
 *
 * Phase 5a recorded the 404 BODY as empty and unfixable from inside a page:
 * `notFound()` thrown after an `await` produced a document whose visible markup
 * was empty, with the designed page present only in the RSC flight payload.
 * The conclusion drawn was that the client never rendered it.
 *
 * The client never rendered ANYTHING. Next 16 blocks cross-origin `/_next/*`
 * dev requests, and the suite drives `127.0.0.1:3100` while the dev server
 * calls itself `localhost:3100` — so every client chunk was refused and React
 * never booted on any page. Server-rendered HTML looked right, forms still
 * worked through progressive enhancement, and no `useEffect` in the application
 * ran at all. `allowedDevOrigins` fixes it (see `next.config.ts`).
 *
 * With the browser actually running the application, the designed 404 renders.
 * The status fix below is real and was needed; the "empty body" was an artefact
 * of measuring through a harness that had disabled the client.
 *
 * What remains true, and is asserted rather than assumed: the visible markup is
 * rendered by the CLIENT, so the server-sent HTML for a data-driven 404 carries
 * the page in its payload rather than its markup. For a 404 that is
 * unimportant — the status is correct and `noindex` is present, so nothing
 * indexes it — but it is the reason this file no longer claims the body is
 * server-rendered.
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
  test(`${label} answers 404 AND renders the designed page`, async ({ page, health }) => {
    health.allowConsoleError(EXPECTED_404_LOG);

    const response = await page.goto(url);

    // THE assertion. Every one of these was 200 before.
    expect(response?.status()).toBe(404);

    // And the page a customer actually sees. This was a `test.fail()` for one
    // session, on the belief that the body could not be rendered from inside a
    // page; it was the harness, not the page.
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Homepage' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse Products' })).toBeVisible();

    // Next's own mitigation, still in place and now belt-and-braces with the
    // status: a crawler that ignored the 404 must still not index this.
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);

    // And it is genuinely not serving catalogue content under a 404.
    await expect(page.locator('main a[href^="/products/"]')).toHaveCount(0);
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
  /*
   * Scoped to `main`: React streams a Suspense boundary through a
   * `<div hidden>` appended to `<body>`, so for a moment the same text is in
   * the document twice and an unscoped match is ambiguous.
   */
  await expect(page.locator('main').getByText('34 products found')).toBeVisible();
});
