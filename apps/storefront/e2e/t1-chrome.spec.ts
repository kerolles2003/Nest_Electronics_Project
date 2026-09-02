import { expect, test } from './fixtures/browser-health';

/**
 * The site chrome, after T1 moved it onto the API.
 *
 * The navbar lives in the ROOT LAYOUT, so its data call ran on every request to
 * every page — including `/shop`, which is otherwise entirely API-backed. That
 * one import is why "no Supabase on the API-backed pages" was not yet true
 * anywhere, and it is why this spec checks the header on several unrelated
 * routes rather than on one: a regression here is a regression everywhere.
 *
 * Under the browser-health fixture, so a console error, a page error, an
 * unhandled rejection or an unexpected 5xx on any of these pages fails the test
 * even when the assertions below pass.
 */

/** Seed categories that must appear in the browse menu, from the API tree. */
const ROOT_CATEGORIES = ['Microcontrollers', 'Sensors', 'Passive Components'];

test('the browse menu is built from the API category tree', async ({ page }) => {
  await page.goto('/');

  const menu = page.locator('header').getByRole('button', { name: 'Browse Categories' });
  await expect(menu).toBeVisible();

  // HOVER first. The dropdown is server-rendered but CSS-hidden
  // (`opacity-0 invisible group-hover:visible`), so asserting visibility
  // without hovering tests the stylesheet rather than the data — which is how
  // the first draft of this spec failed against a page that was working.
  await menu.hover();

  // Scoped to the header's own list, not the page: `/` also renders a category
  // GRID with the same names, and an unscoped search would pass on that
  // instead — proving the grid works and the menu nothing at all.
  const items = page.locator('header').getByRole('listitem');

  for (const name of ROOT_CATEGORIES) {
    await expect(items.filter({ hasText: name }).first()).toBeVisible();
  }
});

test('every browse-menu entry links to its category page', async ({ page }) => {
  await page.goto('/');

  const links = page.locator('header a[href^="/categories/"]');
  const count = await links.count();

  // The menu shows at most 12 roots; the seed has 6. Asserting "more than one"
  // rather than an exact number keeps this from failing every time somebody
  // adds a category, while still failing if the tree comes back empty — which
  // is precisely what a broken fetch looks like.
  expect(count).toBeGreaterThan(1);

  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute('href');

    // A real slug, not `/categories/undefined` — the shape a field-name
    // mismatch in the adapter would produce, and one that renders as a
    // perfectly ordinary-looking link.
    expect(href).toMatch(/^\/categories\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
});

test('the header renders identically on pages that do NOT read the catalogue', async ({ page }) => {
  /*
   * A page with no catalogue data of its own still gets the same header, and
   * before T1 that header was the last Supabase query on the page.
   *
   * This used to load `/shop`, which was exactly such a page. The slice is gone
   * (T3), so `/contact` stands in: static content, no category tree, same
   * header.
   */
  await page.goto('/contact');

  const menu = page.locator('header').getByRole('button', { name: 'Browse Categories' });
  await expect(menu).toBeVisible();
  await menu.hover();

  await expect(page.locator('header a[href^="/categories/"]').first()).toBeVisible();
});

test('the footer renders without reading anything', async ({ page }) => {
  // Recorded because it is a finding, not an omission: the footer is listed in
  // the T1 route set, and it turned out to have NO data dependency at all —
  // every link in it is static. There was nothing to migrate.
  await page.goto('/');

  const footer = page.locator('footer');
  await expect(footer).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Categories' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Brands' })).toBeVisible();
});
