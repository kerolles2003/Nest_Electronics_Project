import { expect, test } from './fixtures/browser-health';

/**
 * `/categories`, `/categories/[slug]` and `/brands/[slug]`, on the API.
 *
 * The acceptance criterion is STRUCTURAL parity, not identical content — the
 * two catalogues hold different mock data by design (D-6), so a page cannot
 * render the same words it rendered before and demanding that would make the
 * criterion either unmeetable or quietly ignored.
 *
 * What these check instead is that every state the design handles is still
 * reached: a category with children and one without, a brand with products and
 * a brand with none, an unknown slug, and a category deeper than two levels.
 * The seed was extended in step 0 specifically so those states exist.
 */

/**
 * A slug the catalogue does not have.
 *
 * ## What is asserted, and the defect that is deliberately NOT asserted
 *
 * Two things are true here and both are checked: the page does not render a
 * product grid, and it carries `<meta name="robots" content="noindex">` so the
 * URL is never indexed.
 *
 * What is NOT checked is that the customer sees a 404 page, because they do not.
 * **`notFound()` on a streaming route renders an empty `<main>` in this
 * application** — header, footer, and nothing between them.
 *
 * That is PRE-EXISTING and has nothing to do with this migration. Measured
 * side by side in one browser session:
 *
 * ```
 *   /this-route-does-not-exist         status=404  main=112 chars  h1=["Page Not Found"]
 *   /products/definitely-not-real      status=200  main=0 chars    h1=[]   <- UN-MIGRATED, still Supabase
 *   /brands/not-a-real-brand           status=200  main=0 chars    h1=[]   <- migrated
 *   /categories/does-not-exist-at-all  status=200  main=0 chars    h1=[]   <- migrated
 * ```
 *
 * The un-migrated route behaves identically to the migrated ones, and a route
 * with no page at all still renders the 404 correctly — so the trigger is
 * streaming, not the data source. Next documents the status half of this ("a
 * 200 status code for streamed responses... the status code cannot be
 * updated") and its own mitigation is the `noindex` tag, which is present. The
 * BLANK BODY is a separate matter and is recorded for the owner rather than
 * fixed in passing: the remedies are removing the root `loading.tsx` or
 * checking existence in `proxy.ts` before the body streams, and both are
 * decisions with costs beyond T1.
 *
 * Asserting the blank body here would be writing a test that pins a defect in
 * place and fails the day somebody fixes it.
 */
async function expectNoCatalogueContent(page: import('@playwright/test').Page, url: string) {
  await page.goto(url);

  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
  await expect(page.locator('main a[href^="/products/"]')).toHaveCount(0);
}

/** Every link to a product in the main grid. These pages use a div grid, not a list. */
function productLinks(page: import('@playwright/test').Page) {
  return page.locator('main a[href^="/products/"]');
}

/**
 * How many DISTINCT products the grid shows.
 *
 * Counting anchors gives twice the answer: each card links to its product from
 * both the image and the title, which is correct markup and a trap for a test
 * that counts links. De-duplicating on the href is the only count that means
 * "products on the page".
 */
async function countProducts(page: import('@playwright/test').Page): Promise<number> {
  const hrefs = await productLinks(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')),
  );

  return new Set(hrefs).size;
}

test.describe('/categories', () => {
  test('lists every root category with its children', async ({ page }) => {
    await page.goto('/categories');

    await expect(page.getByRole('heading', { name: 'Shop by Category' })).toBeVisible();

    const cards = page.locator('main a[href^="/categories/"]');
    await expect(cards.first()).toBeVisible();

    // Six roots in the seed. Asserting a floor rather than the exact number so
    // adding a category does not fail this, while an empty fetch still does.
    expect(await cards.count()).toBeGreaterThanOrEqual(6);
  });

  test('shows a subcategory count on every card, and lists the children it has', async ({ page }) => {
    await page.goto('/categories');

    // `Microcontrollers` has two children; `Power & Batteries` has none. Both
    // branches of the card render, and a card that showed children for the
    // childless one — or none for the parent — would be a tree that came back
    // flat.
    const parent = page.locator('main a[href="/categories/microcontrollers"]');
    await expect(parent).toContainText('2 Subcategories');
    await expect(parent).toContainText('Development Boards');

    const leaf = page.locator('main a[href="/categories/power"]');
    await expect(leaf).toContainText('0 Subcategories');
  });
});

test.describe('/categories/[slug]', () => {
  test('renders a category with its products and its subcategory chips', async ({ page }) => {
    await page.goto('/categories/sensors');

    await expect(page.getByRole('heading', { level: 1, name: 'Sensors' })).toBeVisible();

    // The count comes from the API's `meta.total`, which is the TRUE match
    // count and not the length of the page.
    await expect(page.locator('main').getByText(/^\d+ products$/)).toBeVisible();

    // Chips for the children.
    await expect(page.getByRole('link', { name: 'Environmental Sensors' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Motion & Distance Sensors' })).toBeVisible();

    // A parent shows its DESCENDANTS' products — the subtree match. `sensors`
    // has none of its own, so a page showing zero here would mean the subtree
    // filter had become an exact-category one.
    await expect(productLinks(page).first()).toBeVisible();
  });

  test('handles a category THREE levels deep', async ({ page }) => {
    // `imu-modules` sits under `motion-sensors` under `sensors`. A page that
    // searched only the top level of the tree for its children would render
    // this one with no chips and no error, which is the failure this catches.
    await page.goto('/categories/imu-modules');

    await expect(page.getByRole('heading', { level: 1, name: 'IMU Modules' })).toBeVisible();
    await expect(page.locator('main').getByText('2 products')).toBeVisible();
    expect(await countProducts(page)).toBe(2);
  });

  test('shows no catalogue content for a slug that does not exist', async ({ page }) => {
    // Not an empty product GRID either. A category page that renders "no
    // products found" for a slug that was never real tells a customer they have
    // found an empty shelf rather than a wrong address.
    await expectNoCatalogueContent(page, '/categories/does-not-exist-at-all');
  });
});

test.describe('/brands/[slug]', () => {
  test('renders a brand with its products', async ({ page }) => {
    await page.goto('/brands/espressif');

    await expect(page.getByRole('heading', { level: 1, name: 'Espressif' })).toBeVisible();
    await expect(productLinks(page).first()).toBeVisible();
  });

  test('renders the EMPTY state for a brand that stocks nothing', async ({ page }) => {
    // `sparkfun` exists and has no products. Before the seed was extended this
    // branch was unreachable from real data, so the migration could have broken
    // it invisibly.
    await page.goto('/brands/sparkfun');

    await expect(page.getByRole('heading', { level: 1, name: 'SparkFun' })).toBeVisible();
    await expect(page.getByText('No products found')).toBeVisible();
    await expect(page.locator('main').getByText('0 products')).toBeVisible();
  });

  test('shows no catalogue content for a brand that does not exist', async ({ page }) => {
    await expectNoCatalogueContent(page, '/brands/not-a-real-brand');
  });
});
