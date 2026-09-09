import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { route } from './origin';
import { adminApi, apiUrl, signInAsAdmin } from './fixtures/operations';
import { E2E_NAME_PREFIX, E2E_SKU_PREFIX, E2E_SLUG_PREFIX } from './fixtures/catalogue';
import { pngBuffer } from './fixtures/image';

/**
 * `/products` — the way catalogue data actually enters the system.
 *
 * ## Why this screen is first
 *
 * Everything downstream is a consequence of what is typed here. A price entered
 * wrongly is charged; a SKU entered wrongly is ordered from a supplier; an
 * image attached wrongly is a photograph a live product page shows while a
 * cleanup tool considers it garbage. The order console has had browser coverage
 * since T2 and this screen has had none.
 *
 * ## Every assertion is against the API, not against the page's own echo
 *
 * A React form that renders its optimistic local state satisfies a UI-only
 * assertion perfectly while having written nothing — the same class of
 * hollowness as a suite whose client never booted. So each spec drives the
 * browser and then asks the API what is actually stored. Where the assertion IS
 * about the screen (a cell's contents, a refusal on the form) it is scoped to a
 * `data-testid`, never to a substring of the page: `toContainText('50.00 EGP')`
 * on a whole document is satisfied by a line total, a subtotal or a shipping
 * fee indifferently, which is how seven vacuous assertions reached this
 * repository.
 *
 * ## What it creates, and who removes it
 *
 * Everything is named inside the namespace in `fixtures/catalogue.ts`, and
 * `global-teardown.ts` removes it by that prefix — products, their media, their
 * slug redirects. That is not politeness: the teardown compares the database
 * against the state preparation recorded, so an unremoved product fails the run
 * rather than accumulating quietly.
 */

const RUN = randomUUID().slice(0, 8);

const sku = (label: string): string =>
  `${E2E_SKU_PREFIX}${RUN.toUpperCase()}-${label.toUpperCase()}`;
const slugFor = (label: string): string => `${E2E_SLUG_PREFIX}${RUN}-${label}`;
const nameFor = (label: string): string => `${E2E_NAME_PREFIX}${label} ${RUN}`;

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await adminApi();
});

test.afterAll(async () => {
  await api.dispose();
});

/** The API's own view of a product, for asserting the console wrote what it showed. */
async function readProduct(id: string): Promise<Record<string, unknown>> {
  const response = await api.get(apiUrl(`/admin/catalog/products/${id}`));
  expect(response.status(), 'reading the product back from the API').toBe(200);

  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

function pricing(product: Record<string, unknown>): { basePrice: number; effectivePrice: number } {
  return product['pricing'] as { basePrice: number; effectivePrice: number };
}

function imagePublicIds(product: Record<string, unknown>): string[] {
  return (product['images'] as { publicId: string }[]).map((image) => image.publicId);
}

/**
 * The id of the product the console just created, taken from where it put it.
 *
 * On a successful create the form navigates to `/products/<id>/edit` — stated
 * in `ProductForm.submit`, because the product exists but has no images and no
 * stock and both live on that page. Waiting for that URL is the completion
 * signal AND the id, in one, with no polling and nothing to guess.
 *
 * The first version of this file asked the API for the SKU immediately after
 * clicking. It failed every time, and the screenshot showed exactly why: the
 * save button still spinning. A test that races the thing it is testing reports
 * a defect that is not there, which is worse than no test.
 */
async function idFromTheEditUrl(page: Page): Promise<string> {
  await page.waitForURL(/\/products\/[a-f0-9]{24}\/edit/, { timeout: 60_000 });

  const match = /\/products\/([a-f0-9]{24})\/edit/.exec(page.url());
  expect(match, `the console did not navigate to an edit page: ${page.url()}`).not.toBeNull();

  return (match as RegExpExecArray)[1] as string;
}

/** Any seeded category, for the one required select on the create form. */
async function aCategory(): Promise<{ id: string; name: string }> {
  const response = await api.get(apiUrl('/admin/catalog/categories'));
  expect(response.status()).toBe(200);

  const rows = ((await response.json()) as { data: { id: string; name: { en: string } }[] }).data;
  const first = rows[0];
  expect(first, 'the scratch catalogue has no categories to file a product under').toBeDefined();

  const category = first as { id: string; name: { en: string } };

  return { id: category.id, name: category.name.en };
}

interface NewProduct {
  readonly sku: string;
  readonly slug: string;
  readonly name: string;
  readonly basePrice: string;
  readonly categoryId: string;
}

/**
 * Fills the create form and submits it, without waiting for an outcome.
 *
 * Deliberately only the fields the API requires. A spec that fills every input
 * proves that a full form saves; this proves the MINIMUM does, which is the
 * case an operator hits and the one a new required field would break.
 */
async function submitTheCreateForm(page: Page, fields: NewProduct): Promise<void> {
  await page.goto(route('/products/new'));

  await page.getByTestId('field-name-en').fill(fields.name);
  await page.getByTestId('field-sku').fill(fields.sku);
  await page.getByTestId('field-slug').fill(fields.slug);
  await page.getByTestId('field-base-price').fill(fields.basePrice);
  await page.getByTestId('field-category').selectOption(fields.categoryId);

  await page.getByTestId('product-save').click();
}

/** Creates one through the console and returns its id. Fails if it did not. */
async function createThroughTheForm(page: Page, fields: NewProduct): Promise<string> {
  await submitTheCreateForm(page, fields);

  return idFromTheEditUrl(page);
}

test.describe('the catalogue list', () => {
  test('shows the API’s own price, stock and category for a row, cell by cell', async ({ page }) => {
    const category = await aCategory();
    const productSku = sku('list');

    await signInAsAdmin(page);
    const created = await createThroughTheForm(page, {
      sku: productSku,
      slug: slugFor('list'),
      name: nameFor('List'),
      basePrice: '1234.50',
      categoryId: category.id,
    });
    const stored = await readProduct(created);

    await page.goto(route(`/products?q=${encodeURIComponent(productSku)}`));

    const row = page.getByTestId('product-row');
    await expect(row).toHaveCount(1);

    /*
     * The expected strings are DERIVED from what the API stored, never written
     * out here. A literal '1,234.50 EGP' would pass while the console divided
     * minor units by the wrong power of ten, as long as this file made the same
     * mistake — and the customers screen is where exactly that printed fifty
     * pounds as five thousand. The API is the authority; the page is on trial.
     */
    const expectedPrice = `${(pricing(stored).effectivePrice / 100).toLocaleString('en-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} EGP`;

    await expect(row.getByTestId('product-price')).toHaveText(expectedPrice);
    await expect(row.getByTestId('product-stock')).toHaveText(
      String((stored['stock'] as { onHand: number }).onHand),
    );
    await expect(row.getByTestId('product-category')).toHaveText(category.name);
    await expect(row.getByTestId('product-name')).toHaveText(nameFor('List'));
    await expect(row.getByTestId('product-sku')).toHaveText(productSku);
  });

  test('a search that matches nothing says so, rather than showing the whole catalogue', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto(route(`/products?q=${encodeURIComponent(`no-such-product-${RUN}`)}`));

    await expect(page.getByTestId('product-empty')).toBeVisible();
    await expect(page.getByTestId('product-row')).toHaveCount(0);
  });
});

test.describe('creating a product', () => {
  test('writes exactly what was typed, and creates it UNPUBLISHED', async ({ page }) => {
    const category = await aCategory();
    const productSku = sku('create');

    await signInAsAdmin(page);
    const created = await createThroughTheForm(page, {
      sku: productSku,
      slug: slugFor('create'),
      name: nameFor('Create'),
      basePrice: '499.99',
      categoryId: category.id,
    });
    const stored = await readProduct(created);

    expect((stored['name'] as { en: string }).en).toBe(nameFor('Create'));
    expect(stored['slug']).toBe(slugFor('create'));

    /*
     * MINOR UNITS. 499.99 EGP is 49999, and that conversion is the form's job.
     * Asserting 499.99 here would be asserting the page's arithmetic against
     * itself.
     */
    expect(pricing(stored).basePrice).toBe(49999);

    /*
     * Unpublished, which the form states as a promise ("New products are
     * created unpublished"). It is what stops a bare row with no images and no
     * stock appearing in a customer's search results, and nothing asserted it.
     */
    expect(stored['isActive']).toBe(false);
  });

  /**
   * The slug check reaches a VERDICT, which it had never done.
   *
   * This assertion exists because the browser suite found the defect while
   * doing something else. `ProductForm` fetched `/api/check-slug`, the
   * application is served under `basePath: '/admin'`, and Next does not prefix
   * `basePath` onto a raw `fetch` — so every keystroke got a 404, the form read
   * that as `available: null` and the indicator sat on *unknown* forever.
   *
   * The route handler behind it is careful: it fails CLOSED, because the
   * Supabase one it replaced answered "free" on every failure path and cost an
   * operator a whole filled-in product to a unique-index violation. That care
   * is why nothing noticed — a check that never says "free" never causes a bad
   * save. It also never does its job.
   *
   * So the assertion is not "the indicator renders". It is that the indicator
   * reaches `free` for a slug that is free and `taken` for one that is not,
   * because those are the two answers only a reachable route can give.
   */
  test('the slug check answers free, then taken — not unknown', async ({ page }) => {
    const category = await aCategory();
    const contested = slugFor('slugcheck');

    await signInAsAdmin(page);
    await page.goto(route('/products/new'));
    await page.getByTestId('field-slug').fill(contested);

    await expect(page.getByTestId('slug-status')).toHaveAttribute(
      'data-slug-status',
      'free',
      { timeout: 30_000 },
    );

    await createThroughTheForm(page, {
      sku: sku('slugcheck'),
      slug: contested,
      name: nameFor('Slug Check'),
      basePrice: '15.00',
      categoryId: category.id,
    });

    // The same slug is now taken, and the check must say so rather than
    // shrugging. `unknown` here would be the 404 again.
    await page.goto(route('/products/new'));
    await page.getByTestId('field-slug').fill(contested);

    await expect(page.getByTestId('slug-status')).toHaveAttribute(
      'data-slug-status',
      'taken',
      { timeout: 30_000 },
    );
  });

  test('refuses a duplicate SKU on the form rather than throwing', async ({ page }) => {
    const category = await aCategory();
    const taken = sku('dup');

    /*
     * The FIRST product is a precondition, not the thing on trial, so it is
     * created through the API — the exception `adminApi()` asks callers to
     * state. What this spec is about is what the form does when the SKU is
     * already gone, and driving two full creates to reach that would double the
     * work for no extra coverage: the create path is proven above.
     */
    const existing = await api.post(apiUrl('/admin/catalog/products'), {
      data: {
        sku: taken,
        slug: slugFor('dup'),
        name: { en: nameFor('Dup') },
        categoryId: category.id,
        // Piastres, which is what the API stores. The FORM's job is turning
        // "10.00" into this; here it is written directly because the form is
        // not what this call is exercising.
        basePrice: 1000,
      },
    });
    expect(existing.status(), 'seeding the conflicting product').toBe(201);

    await signInAsAdmin(page);

    // The same SKU, under a different slug, so the SKU is the only conflict.
    // Submitted WITHOUT waiting for a navigation, because the whole point of
    // the spec is that there must not be one.
    await submitTheCreateForm(page, {
      sku: taken,
      slug: slugFor('dup-2'),
      name: nameFor('Dup Two'),
      basePrice: '10.00',
      categoryId: category.id,
    });

    /*
     * Scoped to the form's own error region. An unscoped check for the word
     * "SKU" matches the field's label, its helper text and its placeholder —
     * all on the page whether or not anything was refused.
     */
    await expect(page.getByTestId('form-error')).toBeVisible();
    await expect(page).toHaveURL(/\/products\/new/);
  });
});

test.describe('editing a product', () => {
  test('a price changed here is the price the API holds', async ({ page }) => {
    const category = await aCategory();
    const productSku = sku('edit');

    await signInAsAdmin(page);
    const created = await createThroughTheForm(page, {
      sku: productSku,
      slug: slugFor('edit'),
      name: nameFor('Edit'),
      basePrice: '100.00',
      categoryId: category.id,
    });
    expect(pricing(await readProduct(created)).basePrice).toBe(10000);

    await page.goto(route(`/products/${created}/edit`));
    await page.getByTestId('field-base-price').fill('250.75');
    await page.getByTestId('product-save').click();

    await expect
      .poll(async () => pricing(await readProduct(created)).basePrice, {
        message: 'the API should hold the edited price',
        timeout: 30_000,
      })
      .toBe(25075);
  });

  test('the SKU is immutable, and the form refuses to be typed in rather than discarding it', async ({
    page,
  }) => {
    const category = await aCategory();
    const productSku = sku('immutable');

    await signInAsAdmin(page);
    const created = await createThroughTheForm(page, {
      sku: productSku,
      slug: slugFor('immutable'),
      name: nameFor('Immutable'),
      basePrice: '20.00',
      categoryId: category.id,
    });

    await page.goto(route(`/products/${created}/edit`));

    /*
     * Asserted as READONLY on the control, not as "the value did not change".
     * A field that accepts typing and discards it on save is a worse version of
     * the same bug: the operator is told the SKU is now something it is not.
     */
    await expect(page.getByTestId('field-sku')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('field-sku')).toHaveValue(productSku);
  });
});

test.describe('the image manager', () => {
  /**
   * The attach path, and the guarantee it exists to create.
   *
   * `POST /admin/media` opens a ledger row at `refCount: 0`;
   * `POST /admin/catalog/products/:id/images` is what RETAINS it. Those are two
   * calls and the console makes both — an asset attached without being retained
   * is a photograph a live product page shows while `DELETE /admin/media` and
   * the reconciliation report both consider it garbage. That is legacy defect
   * W4.
   *
   * The API's own suite proves `retain()` from the API side. What was never
   * proved is that the CONSOLE's attach produces the same protection, which is
   * the path every real photograph in this catalogue will take.
   */
  test('an image attached HERE is retained, and cannot then be destroyed', async ({ page }) => {
    const category = await aCategory();
    const productSku = sku('image');

    await signInAsAdmin(page);
    const created = await createThroughTheForm(page, {
      sku: productSku,
      slug: slugFor('image'),
      name: nameFor('Image'),
      basePrice: '75.00',
      categoryId: category.id,
    });

    await page.goto(route(`/products/${created}/edit`));
    await expect(page.getByTestId('image-empty')).toBeVisible();

    await page.getByTestId('image-file-input').setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: pngBuffer(320, 240, 1),
    });

    const tile = page.getByTestId('image-tile');
    await expect(tile).toHaveCount(1, { timeout: 60_000 });

    // The first image attached becomes the primary — promised by the empty
    // state, asserted on the tile rather than on the copy that promises it.
    await expect(tile.first()).toHaveAttribute('data-primary', 'true');

    const publicId = await tile.first().getAttribute('data-public-id');
    expect(publicId, 'the tile must name the asset it is showing').not.toBeNull();

    // The API agrees the product carries it. The tile alone could be local state.
    expect(imagePublicIds(await readProduct(created))).toContain(publicId);

    /*
     * THE POINT OF THE WHOLE SPEC.
     *
     * Destroying it is refused while the product references it. A 409 here is
     * the reference ledger doing its job; a 204 would mean the console attached
     * a photograph without retaining it, and the asset would be destroyed by
     * the next operator running a cleanup, with the product page still pointing
     * at it.
     */
    const refused = await api.delete(
      apiUrl(`/admin/media?publicId=${encodeURIComponent(publicId as string)}`),
    );
    expect(refused.status(), 'a referenced asset must not be destroyable').toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'MEDIA_ASSET_IN_USE',
    );

    /*
     * And it SURVIVED the refusal. A 409 that had already deleted the object
     * would be worse than a 204, because the report would read as safe.
     */
    expect(imagePublicIds(await readProduct(created))).toContain(publicId);
  });

  test('detaching in the console releases the reference, and only then may it be destroyed', async ({
    page,
  }) => {
    const category = await aCategory();
    const productSku = sku('detach');

    await signInAsAdmin(page);
    const created = await createThroughTheForm(page, {
      sku: productSku,
      slug: slugFor('detach'),
      name: nameFor('Detach'),
      basePrice: '75.00',
      categoryId: category.id,
    });

    await page.goto(route(`/products/${created}/edit`));
    await page.getByTestId('image-file-input').setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: pngBuffer(320, 240, 2),
    });

    const tile = page.getByTestId('image-tile');
    await expect(tile).toHaveCount(1, { timeout: 60_000 });

    const publicId = (await tile.first().getAttribute('data-public-id')) as string;

    await page.getByTestId('image-detach').first().click();
    await expect(tile).toHaveCount(0, { timeout: 60_000 });

    /*
     * Detach RELEASES; it never destroys — the console says as much ("The file
     * itself is kept"). So the asset is still there, at zero references, which
     * is the state reconciliation reports and an operator may act on.
     */
    expect(imagePublicIds(await readProduct(created))).toHaveLength(0);

    const destroyed = await api.delete(
      apiUrl(`/admin/media?publicId=${encodeURIComponent(publicId)}`),
    );
    expect(destroyed.status(), 'an unreferenced asset must be destroyable').toBe(204);
  });
});

test.describe('deleting and restoring', () => {
  test('a deleted product leaves the list, keeps its SKU, and comes back', async ({ page }) => {
    const category = await aCategory();
    const productSku = sku('delete');

    await signInAsAdmin(page);
    const created = await createThroughTheForm(page, {
      sku: productSku,
      slug: slugFor('delete'),
      name: nameFor('Delete'),
      basePrice: '33.00',
      categoryId: category.id,
    });

    await page.goto(route(`/products?q=${encodeURIComponent(productSku)}`));
    await page.getByTestId('product-delete').first().click();
    await page.getByTestId('delete-confirm').click();

    await expect(page.getByTestId('product-row')).toHaveCount(0, { timeout: 60_000 });

    /*
     * The SKU STAYS TAKEN, which the confirmation dialog promises and which
     * nothing verified. It is the difference between a recoverable delete and a
     * destructive one: reusing the code would repoint existing links at a
     * different product.
     */
    const deleted = await readProduct(created);
    expect(deleted['deletedAt']).not.toBeNull();
    expect(deleted['sku']).toBe(productSku);

    await page.goto(route(`/products?state=deleted&q=${encodeURIComponent(productSku)}`));
    await expect(page.getByTestId('product-row')).toHaveCount(1);

    await page.getByTestId('product-restore').first().click();

    await expect
      .poll(async () => (await readProduct(created))['deletedAt'], {
        message: 'restoring in the console should clear deletedAt',
        timeout: 60_000,
      })
      .toBeNull();
  });
});
