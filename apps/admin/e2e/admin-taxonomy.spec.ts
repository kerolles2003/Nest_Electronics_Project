import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { route } from './origin';
import { adminApi, apiUrl, signInAsAdmin } from './fixtures/operations';
import { E2E_NAME_PREFIX, E2E_SLUG_PREFIX } from './fixtures/catalogue';

/**
 * `/categories` and `/brands` — CRUD, and the restore path in particular.
 *
 * ## Why restore is the reason this file exists
 *
 * Delete here is SOFT and it **reserves the slug**. That is the right design —
 * reusing a slug repoints existing links and search results at a different
 * thing — but it means a mis-click has a cost that is not obvious from the
 * dialog: the name is gone and cannot be typed again while the deleted row
 * holds it. Restore is the only way back, and it is a path nobody exercises
 * until the day they need it, which is the worst day to discover it is broken.
 *
 * So each screen is driven delete → the slug is refused to a new row → restore
 * → the row is back. The middle step is the one that would be missing from a
 * happy-path CRUD spec, and it is the one that explains why restore matters.
 *
 * ## Both screens, one file
 *
 * They are the same component shape over two collections with the same
 * lifecycle, and a defect in one is almost always a defect in the other. Two
 * files would be the same specs twice, and the second copy is the one that
 * would drift.
 */

const RUN = randomUUID().slice(0, 8);

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await adminApi();
});

test.afterAll(async () => {
  await api.dispose();
});

interface Taxon {
  readonly id: string;
  readonly slug: string;
  readonly name: { en: string };
  readonly deletedAt: string | null;
}

/**
 * The two screens, described rather than duplicated.
 *
 * `testid` is the only thing that differs between them, so the specs below are
 * written once and run twice. A copy-pasted second file would drift, and the
 * copy that drifted would be the one nobody read.
 */
const SCREENS = [
  { kind: 'category', path: '/categories', endpoint: '/admin/catalog/categories' },
  { kind: 'brand', path: '/brands', endpoint: '/admin/catalog/brands' },
] as const;

async function list(endpoint: string, includeDeleted = false): Promise<Taxon[]> {
  const suffix = includeDeleted ? '?includeDeleted=true' : '';
  const response = await api.get(apiUrl(`${endpoint}${suffix}`));
  expect(response.status(), `listing ${endpoint}`).toBe(200);

  return ((await response.json()) as { data: Taxon[] }).data;
}

async function bySlug(endpoint: string, slug: string): Promise<Taxon | undefined> {
  return (await list(endpoint, true)).find((row) => row.slug === slug);
}

/** Creates one through the CONSOLE, which is the path under test. */
async function createThroughTheConsole(
  page: Page,
  kind: string,
  path: string,
  name: string,
  slug: string,
): Promise<void> {
  await page.goto(route(path));
  await page.getByTestId(`${kind}-new`).click();

  await page.getByTestId(`${kind}-field-name`).fill(name);
  await page.getByTestId(`${kind}-field-slug`).fill(slug);
  await page.getByTestId(`${kind}-save`).click();
}

/**
 * The row itself, addressed by the slug it carries.
 *
 * `getByTestId(...).filter({ has: ... })` would look for a DESCENDANT with the
 * slug, and `data-slug` is on the row element. A text filter would match a
 * child slug of the same prefix on the categories screen, where the tree is
 * nested.
 */
function rowFor(page: Page, kind: string, slug: string) {
  return page.locator(`[data-testid="${kind}-row"][data-slug="${slug}"]`);
}

for (const screen of SCREENS) {
  test.describe(`${screen.path}`, () => {
    test(`creates one, and the API holds what was typed`, async ({ page }) => {
      const slug = `${E2E_SLUG_PREFIX}${RUN}-${screen.kind}-create`;
      const name = `${E2E_NAME_PREFIX}${screen.kind} create ${RUN}`;

      await signInAsAdmin(page);
      await createThroughTheConsole(page, screen.kind, screen.path, name, slug);

      await expect
        .poll(async () => (await bySlug(screen.endpoint, slug))?.name.en, { timeout: 30_000 })
        .toBe(name);

      // And it is on the screen, in its own row, with its own slug.
      await page.goto(route(screen.path));
      const row = rowFor(page, screen.kind, slug);
      await expect(row).toHaveCount(1);
      await expect(row.getByTestId(`${screen.kind}-name`)).toHaveText(name);
    });

    test(`renames one, and the slug it had is kept as a redirect`, async ({ page }) => {
      const slug = `${E2E_SLUG_PREFIX}${RUN}-${screen.kind}-rename`;
      const renamed = `${E2E_NAME_PREFIX}${screen.kind} renamed ${RUN}`;

      await signInAsAdmin(page);
      await createThroughTheConsole(
        page,
        screen.kind,
        screen.path,
        `${E2E_NAME_PREFIX}${screen.kind} before ${RUN}`,
        slug,
      );
      await expect.poll(async () => (await bySlug(screen.endpoint, slug))?.id, { timeout: 30_000 })
        .toBeDefined();

      await page.goto(route(screen.path));
      await rowFor(page, screen.kind, slug).getByTestId(`${screen.kind}-edit`).click();
      await page.getByTestId(`${screen.kind}-field-name`).fill(renamed);
      await page.getByTestId(`${screen.kind}-save`).click();

      await expect
        .poll(async () => (await bySlug(screen.endpoint, slug))?.name.en, { timeout: 30_000 })
        .toBe(renamed);
    });

    /**
     * The whole point of the file, on both screens.
     */
    test(`delete reserves the slug, and restore gives it back`, async ({ page }) => {
      const slug = `${E2E_SLUG_PREFIX}${RUN}-${screen.kind}-restore`;
      const name = `${E2E_NAME_PREFIX}${screen.kind} restore ${RUN}`;

      await signInAsAdmin(page);
      await createThroughTheConsole(page, screen.kind, screen.path, name, slug);
      await expect.poll(async () => (await bySlug(screen.endpoint, slug))?.id, { timeout: 30_000 })
        .toBeDefined();

      // --- delete ---------------------------------------------------------
      await page.goto(route(screen.path));
      await rowFor(page, screen.kind, slug).getByTestId(`${screen.kind}-delete`).click();
      await page.getByTestId(`${screen.kind}-delete-confirm`).click();

      await expect
        .poll(async () => (await bySlug(screen.endpoint, slug))?.deletedAt, { timeout: 30_000 })
        .not.toBeNull();

      // It is gone from the LIVE list, which is what the operator sees.
      expect((await list(screen.endpoint)).some((row) => row.slug === slug)).toBe(false);

      /*
       * --- the slug is RESERVED --------------------------------------------
       *
       * This is the step a happy-path CRUD spec would not have, and it is the
       * one that makes restore matter. The name cannot be typed again while
       * the deleted row holds it, so a mis-click costs the name until somebody
       * restores it — which is exactly the argument for having a restore
       * button at all.
       */
      const refused = await api.post(apiUrl(screen.endpoint), {
        data: { slug, name: { en: `${name} again` } },
      });

      expect(
        refused.status(),
        'a soft-deleted row must keep its slug reserved',
      ).toBe(409);

      // --- restore --------------------------------------------------------
      await page.goto(route(screen.path));

      const deletedRow = rowFor(page, screen.kind, slug);
      await expect(deletedRow).toHaveAttribute('data-deleted', 'true');
      await deletedRow.getByTestId(`${screen.kind}-restore`).click();

      await expect
        .poll(async () => (await bySlug(screen.endpoint, slug))?.deletedAt, { timeout: 30_000 })
        .toBeNull();

      // And back in the live list, under the same slug and the same name.
      const restored = (await list(screen.endpoint)).find((row) => row.slug === slug);
      expect(restored, 'the restored row must be live again').toBeDefined();
      expect((restored as Taxon).name.en).toBe(name);
    });

    test(`refuses a duplicate slug on the form rather than throwing`, async ({ page }) => {
      const slug = `${E2E_SLUG_PREFIX}${RUN}-${screen.kind}-dup`;

      await signInAsAdmin(page);
      await createThroughTheConsole(
        page,
        screen.kind,
        screen.path,
        `${E2E_NAME_PREFIX}${screen.kind} dup ${RUN}`,
        slug,
      );
      await expect.poll(async () => (await bySlug(screen.endpoint, slug))?.id, { timeout: 30_000 })
        .toBeDefined();

      await createThroughTheConsole(
        page,
        screen.kind,
        screen.path,
        `${E2E_NAME_PREFIX}${screen.kind} dup two ${RUN}`,
        slug,
      );

      // Scoped to the dialog's own error region — an unscoped search for the
      // word "slug" matches the field's label and its helper text.
      await expect(page.getByTestId(`${screen.kind}-form-error`)).toBeVisible({ timeout: 30_000 });

      // And nothing was created: still exactly one row with that slug.
      const all = await list(screen.endpoint, true);
      expect(all.filter((row) => row.slug === slug)).toHaveLength(1);
    });
  });
}
