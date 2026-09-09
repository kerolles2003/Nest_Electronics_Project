import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { route } from './origin';
import { DEV_ADMIN_NAME, adminApi, apiUrl, signInAsAdmin } from './fixtures/operations';
import { E2E_NAME_PREFIX, E2E_SKU_PREFIX, E2E_SLUG_PREFIX } from './fixtures/catalogue';

/**
 * `/audit-log` — the lowest-risk screen here, and the one with the worst
 * failure mode when it is wrong.
 *
 * A trail that is empty when it should not be does not look broken. It looks
 * like nothing happened. That is exactly what this screen used to show: the
 * acting admin is an API account and the old page read Supabase `profiles`, so
 * **every administrative action was invisible on the page that exists to record
 * them** — and an empty audit log reads as a quiet system rather than as a
 * defect.
 *
 * So the spec does not check that the screen renders. It performs an
 * administrative action, then requires THAT action to be on THIS screen,
 * attributed to the operator who took it.
 *
 * ## Read-only is asserted as an absence
 *
 * `AUDIT-MODEL.md` §8 makes write, update and delete available to nobody, and
 * the API suite asserts it as the absence of POST, PATCH and DELETE routes
 * rather than as a permission check. This file asserts the console side of the
 * same rule: the screen offers no control that could alter a record. An
 * assertion that a delete button is *disabled* would be a weaker claim about a
 * button that should not exist.
 */

const RUN = randomUUID().slice(0, 8);

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await adminApi();
});

test.afterAll(async () => {
  await api.dispose();
});

interface AuditRow {
  readonly action: string;
  readonly entity: { type: string; label: string };
  readonly actor: { name: string; role: string };
}

async function trail(query = ''): Promise<AuditRow[]> {
  const response = await api.get(apiUrl(`/admin/audit-logs${query}`));
  expect(response.status(), 'reading the audit trail from the API').toBe(200);

  return ((await response.json()) as { data: AuditRow[] }).data;
}

/**
 * Takes one auditable action and returns what it should be recorded as.
 *
 * A product create, because it is unambiguous: one row, one action, one entity,
 * and the label is a name this run invented so it cannot be confused with
 * anything else in the trail.
 */
async function anAuditableAction(suffix: string): Promise<{ label: string; action: string }> {
  const categories = await api.get(apiUrl('/admin/catalog/categories'));
  expect(categories.status()).toBe(200);
  const categoryId = ((await categories.json()) as { data: { id: string }[] }).data[0]?.id as string;

  /*
   * The audit entity's `label` is the SKU, not the product name — see
   * `product-admin.service.ts`, which records
   * `entity: { type: PRODUCT, id, label: created.sku }`. A SKU is stable,
   * unique and printed on the thing itself, which is what a trail read a year
   * later needs; the name is none of those. So the SKU is what this spec looks
   * for, and it carries the run id so it cannot collide with an earlier run's
   * row still in the trail.
   */
  const sku = `${E2E_SKU_PREFIX}${RUN.toUpperCase()}-AUDIT-${suffix.toUpperCase()}`;

  const created = await api.post(apiUrl('/admin/catalog/products'), {
    data: {
      sku,
      slug: `${E2E_SLUG_PREFIX}${RUN}-audit-${suffix}`,
      name: { en: `${E2E_NAME_PREFIX}Audited ${suffix} ${RUN}` },
      categoryId,
      basePrice: 2500,
    },
  });
  expect(created.status(), 'taking an auditable action').toBe(201);

  return { label: sku, action: 'PRODUCT_CREATED' };
}

test.describe('the trail is readable, and it is the real one', () => {
  test('an administrative action appears here, attributed to whoever took it', async ({ page }) => {
    const taken = await anAuditableAction('appears');

    await signInAsAdmin(page);
    await page.goto(route(`/audit-log?action=${taken.action}`));

    /*
     * Scoped to the entry for THIS action, found by the label this run
     * invented. A page-wide check for "PRODUCT_CREATED" would pass on any of
     * the trail's other rows — including ones from a previous run — which is
     * indistinguishable from the screen having recorded nothing new.
     */
    const entry = page
      .getByTestId('audit-entry')
      .filter({ has: page.getByTestId('audit-entity').getByText(taken.label, { exact: true }) });

    await expect(entry).toHaveCount(1, { timeout: 30_000 });
    await expect(entry).toHaveAttribute('data-action', taken.action);
    await expect(entry).toHaveAttribute('data-entity-type', 'PRODUCT');

    /*
     * And the ACTOR. An audit row that records what happened but not who did it
     * is a log, not an audit — and attribution is the whole reason this screen
     * was rebuilt: it used to read Supabase `profiles`, where the API's
     * operator account does not exist, so every row it could have shown was
     * unattributable.
     */
    await expect(entry.getByTestId('audit-actor')).toHaveText(DEV_ADMIN_NAME);
  });

  test('the screen and the API agree about what the trail contains', async ({ page }) => {
    const taken = await anAuditableAction('agree');

    const rows = await trail(`?action=${taken.action}&limit=25`);
    const recorded = rows.find((row) => row.entity.label === taken.label);

    expect(recorded, 'the API must hold the row the screen is being asked about').toBeDefined();

    await signInAsAdmin(page);
    await page.goto(route(`/audit-log?action=${taken.action}`));

    const entry = page
      .getByTestId('audit-entry')
      .filter({ has: page.getByTestId('audit-entity').getByText(taken.label, { exact: true }) });

    await expect(entry).toHaveCount(1, { timeout: 30_000 });
    await expect(entry.getByTestId('audit-actor')).toHaveText((recorded as AuditRow).actor.name);
  });

  test('a filter that matches nothing says so, rather than showing the whole trail', async ({
    page,
  }) => {
    await signInAsAdmin(page);

    /*
     * A real action name that this run cannot have caused. An invented one
     * would be rejected by the API and the page would be reporting a validation
     * failure rather than an empty result — a different thing that looks the
     * same on screen.
     */
    await page.goto(route('/audit-log?action=SHIPPING_RATE_CHANGED&actorId=000000000000000000000000'));

    await expect(page.getByTestId('audit-empty')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('audit-entry')).toHaveCount(0);
  });
});

test.describe('read-only, asserted as an absence', () => {
  test('offers no control that could alter a record', async ({ page }) => {
    await anAuditableAction('readonly');

    await signInAsAdmin(page);
    await page.goto(route('/audit-log'));

    await expect(page.getByTestId('audit-entry').first()).toBeVisible({ timeout: 30_000 });

    /*
     * There is no route to call — `AUDIT-MODEL.md` §8 makes write, update and
     * delete available to nobody, and the API suite asserts that as the ABSENCE
     * of POST, PATCH and DELETE rather than as a permission check. This is the
     * console half of the same rule.
     *
     * Asserted as absence rather than as a disabled control: a disabled button
     * is a claim that the action exists and is currently refused, which is a
     * different and weaker guarantee than "there is nothing here that could do
     * it".
     */
    for (const name of [/delete/i, /remove/i, /edit/i, /save/i]) {
      await expect(
        page.getByRole('button', { name }),
        `the audit trail must offer no ${String(name)} control`,
      ).toHaveCount(0);
    }
  });

  test('and the API has no route that could remove one', async () => {
    /*
     * The guarantee that actually holds the line. The console could grow a
     * button tomorrow; what makes the trail immutable is that there is nothing
     * for it to call. Asserted here too because this suite is the one that
     * drives the console, and a console-only assertion would leave the claim
     * resting on the absence of a button.
     */
    const rows = await trail('?limit=1');
    expect(rows.length, 'the trail must have something to try to delete').toBeGreaterThan(0);

    for (const method of ['post', 'patch', 'delete'] as const) {
      const response = await api[method](apiUrl('/admin/audit-logs'), { data: {} });

      expect(
        response.status(),
        `${method.toUpperCase()} /admin/audit-logs must not be a route`,
      ).toBe(404);
    }
  });
});
