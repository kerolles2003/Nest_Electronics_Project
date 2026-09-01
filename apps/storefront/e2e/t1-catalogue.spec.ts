import { expect, test } from './fixtures/browser-health';

/**
 * `/`, `/products`, `/products/[slug]`, `/search` and the sitemap, on the API.
 *
 * Structural parity, not identical content. What is checked is that every state
 * the design handles is still reached with the new data source — including the
 * ones the seed could not produce before step 0 extended it: a product with a
 * gallery, a product with no reviews, an out-of-stock card, a discount badge.
 */

/** Every link to a product in a grid. Cards link twice, so counts de-duplicate. */
function productLinks(page: import('@playwright/test').Page) {
  return page.locator('main a[href^="/products/"]');
}

async function countProducts(page: import('@playwright/test').Page): Promise<number> {
  const hrefs = await productLinks(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')),
  );

  return new Set(hrefs).size;
}

test.describe('/', () => {
  test('renders the hero, both product rails and the brand strip', async ({ page }) => {
    await page.goto('/');

    // Each rail streams behind its own Suspense boundary, so the assertions
    // wait rather than assuming they arrived with the shell.
    await expect(page.getByRole('heading', { name: 'All categories' })).toBeVisible();
    await expect(page.getByText('Supplier lines currently stocked')).toBeVisible();

    // 8 featured + 10 newest, overlapping, plus whatever the hero links to.
    expect(await countProducts(page)).toBeGreaterThan(8);
  });

  test('shows category artwork rather than falling back to icons', async ({ page }) => {
    /*
     * The tile images are named for the CATEGORY SLUG, and the files were named
     * for the legacy slugs — none of which the API uses. Without the matching
     * copies every tile would silently fall back to a generic icon and fire a
     * failed image request, which is a visible regression that no assertion
     * about text would have caught.
     */
    await page.goto('/');

    const tiles = page.locator('main a[href^="/categories/"] img');
    await expect(tiles.first()).toBeVisible();

    // Six roots, all with artwork.
    expect(await tiles.count()).toBeGreaterThanOrEqual(6);
  });
});

test.describe('/products', () => {
  test('lists a page of products with the true total', async ({ page }) => {
    await page.goto('/products');

    // 34 seeded products, 16 per page.
    await expect(page.getByText('34 products found')).toBeVisible();
    expect(await countProducts(page)).toBe(16);
  });

  test('paginates', async ({ page }) => {
    await page.goto('/products?page=3');

    // 34 products, 16 per page -> page 3 holds the last two.
    expect(await countProducts(page)).toBe(2);
  });

  test('filters by category, and the filter is removable', async ({ page }) => {
    await page.goto('/products?category=tools');

    await expect(page.getByText('3 products found')).toBeVisible();
    // The active-filter chip resolves the slug to a NAME from the category
    // list, so a chip reading "tools" would mean the lookup failed.
    await expect(page.locator('main').getByRole('link', { name: /Tools & Equipment/ })).toBeVisible();
  });

  test('filters by brand and by stock', async ({ page }) => {
    await page.goto('/products?brand=espressif');
    await expect(page.getByText('4 products found')).toBeVisible();

    await page.goto('/products?in_stock=true');
    // 34 products, 3 of them out of stock.
    await expect(page.getByText('31 products found')).toBeVisible();
  });

  test('filters by price, converting the URL major units to the API minor units', async ({ page }) => {
    // ?min_price=1000 means 1,000.00 EGP -> 100000 piastres on the wire. Send
    // the number unconverted and this returns every product in the catalogue.
    await page.goto('/products?min_price=1000');

    const count = await countProducts(page);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(16);
  });

  test('sorts, and treats "featured" as the filter the API actually offers', async ({ page }) => {
    await page.goto('/products?sort=price_asc');
    const ascending = await productLinks(page).first().getAttribute('href');

    await page.goto('/products?sort=price_desc');
    const descending = await productLinks(page).first().getAttribute('href');

    expect(ascending).not.toBe(descending);

    // `featured` is not a sort in the frozen API enum, so it is mapped to the
    // `featured=true` FILTER. Eight products are featured.
    await page.goto('/products?sort=featured');
    await expect(page.getByText('8 products found')).toBeVisible();
  });

  test('does not error on a hand-edited sort value', async ({ page }) => {
    // An unrecognised `?sort=` would be a 400 UNSUPPORTED_SORT if forwarded.
    await page.goto('/products?sort=totally-made-up');

    await expect(page.getByText('34 products found')).toBeVisible();
  });

  test('renders the empty state when nothing matches', async ({ page }) => {
    await page.goto('/products?q=zzzzznothingmatchesthis');

    await expect(page.getByRole('heading', { name: 'No products found' })).toBeVisible();
    expect(await countProducts(page)).toBe(0);
  });
});

test.describe('/products/[slug]', () => {
  test('renders a product with a GALLERY when it has several images', async ({ page }) => {
    // Three images. Before step 0 extended the seed, no product had ANY image,
    // so `images.length > 1` was unreachable and this whole branch could have
    // been broken by the migration without anything noticing.
    await page.goto('/products/mpu9250-9-axis-imu');

    await expect(page.getByRole('heading', { level: 1, name: 'MPU-9250 9-Axis IMU' })).toBeVisible();
    await expect(page.getByText('MPU9250-9DOF')).toBeVisible();

    // The main image plus a thumbnail strip. The URLs do not resolve without a
    // Cloudinary account, so the assertion is on the STRUCTURE the image count
    // drives — which is the half that has to survive this migration.
    await expect(page.getByRole('link', { name: 'DFRobot' })).toBeVisible();
  });

  test('renders the specification table with units', async ({ page }) => {
    // `specs` carries a unit the legacy attribute join had nowhere to put.
    await page.goto('/products/esp32-devkit-v1');

    await expect(page.getByRole('cell', { name: 'Clock Speed' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '240 MHz' })).toBeVisible();
  });

  test('shows the discount badge and both prices for a product on sale', async ({ page }) => {
    // 325.00 down to 280.00 — a 14% cut.
    await page.goto('/products/esp32-devkit-v1');

    await expect(page.getByText('-14%')).toBeVisible();
    await expect(page.getByText('IN STOCK')).toBeVisible();
  });

  test('shows OUT OF STOCK and disables the button for a product with none', async ({ page }) => {
    await page.goto('/products/bno055-orientation-sensor');

    /*
     * BOTH, and separately.
     *
     * `getByText('OUT OF STOCK')` alone is a strict-mode violation here —
     * matching is case-insensitive, so it resolves to the badge AND the
     * disabled "Out of Stock" button. That ambiguity is worth resolving into
     * two assertions rather than a `.first()`: the badge is what the customer
     * reads, the disabled button is what stops them ordering, and a page that
     * showed one without the other would be worse than one that showed
     * neither.
     */
    await expect(page.getByText('OUT OF STOCK', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Out of Stock' })).toBeDisabled();
  });

  test('renders related products, excluding the product itself', async ({ page }) => {
    // The API's own related endpoint already excludes it; the old code asked
    // for one extra and filtered client-side, so the row silently varied in
    // length depending on where the product sorted.
    await page.goto('/products/esp32-devkit-v1');

    await expect(page.getByRole('heading', { name: 'Related Products' })).toBeVisible();

    const hrefs = await page
      .locator('main a[href^="/products/"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));

    expect(hrefs).not.toContain('/products/esp32-devkit-v1');
  });

  /*
   * Dead-link behaviour moved to `e2e/not-found.spec.ts`.
   *
   * The test that stood here asserted `noindex` and the absence of catalogue
   * content, and deliberately did NOT assert a status, because the status was
   * 200 and pinning it would have frozen the defect. It is 404 now, and the new
   * spec asserts the status, the `noindex`, the absence of catalogue content
   * and — as a `test.fail()` — the rendered page. Keeping a weaker copy here
   * would mean two places to edit and one of them silently going stale.
   */
});

test.describe('/search', () => {
  test('prompts when there is no query, without asking the API anything', async ({ page }) => {
    await page.goto('/search');

    await expect(page.getByRole('heading', { name: 'Search for products' })).toBeVisible();
    expect(await countProducts(page)).toBe(0);
  });

  test('finds products by name', async ({ page }) => {
    await page.goto('/search?q=esp32');

    await expect(page.locator('main').getByText(/results for/)).toBeVisible();
    expect(await countProducts(page)).toBeGreaterThan(0);
  });

  test('finds a product by its SKU, which is the whole point of the search model', async ({ page }) => {
    // Makers search by part number. SEARCH-MODEL.md weights SKU as a
    // first-class match; a `LIKE` over the name column would find nothing here.
    await page.goto('/search?q=RPI-PICO-2W');

    expect(await countProducts(page)).toBeGreaterThan(0);
    await expect(productLinks(page).first()).toHaveAttribute(
      'href',
      '/products/raspberry-pi-pico-2-w',
    );
  });

  test('renders the no-results state', async ({ page }) => {
    await page.goto('/search?q=zzzzznothingmatchesthis');

    await expect(page.getByRole('heading', { name: /No results for/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse All Products' })).toBeVisible();
  });
});

test.describe('sitemap', () => {
  test('lists every product, category and brand from the API', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    const xml = (await response?.text()) ?? '';

    const urls = xml.match(/<loc>/g)?.length ?? 0;

    // 6 static + 13 categories + 7 brands + 34 products.
    expect(urls).toBe(60);

    // A SUBCATEGORY, which the tree endpoint would have nested out of a `.map`
    // and silently omitted. The flat list is the one a sitemap wants.
    expect(xml).toContain('/categories/imu-modules');

    // A product from page 2 of the API's 100-per-page limit is not proof at 34
    // products, but the paging loop must at least reach the last one.
    expect(xml).toContain('/products/usb-logic-analyser-8-channel');
  });
});
