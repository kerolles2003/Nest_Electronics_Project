import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures/browser-health';
import { E2E_EMAIL_PREFIX } from './global-teardown';

/**
 * The guest-cart merge, in a real browser against the real API.
 *
 * `guest-cart-merge.spec.ts` proves the RULES as pure functions. This proves
 * they reach the cart: that the store is read, the plan is frozen, the writes
 * land, the customer is told what changed, and — the case worth the most — that
 * an interrupted merge retried does not double anybody's basket.
 *
 * ## Why the assertions read the API rather than the page
 *
 * The cart page is a rendering of the cart; the cart is the thing under test.
 * Asserting on the API's own JSON gives the quantity of each line exactly,
 * rather than whatever the page chose to show, and it is the only way to prove
 * "5, not 4 and not 10". The page IS checked once, at the end, so the wiring is
 * not taken on trust either.
 *
 * ## One account, and why the rule cases do not use the login form
 *
 * Registration is throttled to 3 per hour per IP and login to 5 per 15 minutes,
 * which are the right limits for humans and a hard ceiling for a suite that
 * wanted an account each. So the file creates ONE account and resets its cart
 * between cases.
 *
 * The rule cases then install the session cookies directly rather than driving
 * the sign-in form. That is not a shortcut around something under test: what is
 * under test is the MERGE, and a form submission is a slower way to arrive at
 * the same authenticated state. **One case does sign in for real**, end to end
 * through the form, so the trigger is never taken on trust.
 *
 * ## Data
 *
 * One real account in the `e2e-journey.` namespace that `globalTeardown`
 * deletes along with its cart. The seeded catalogue is only READ.
 */

test.describe.configure({ mode: 'serial' });

const API = process.env['API_BASE_URL'] ?? 'http://127.0.0.1:3002/api/v1';
const PASSWORD = 'brass thermionic valve';

const STORE_KEY = 'nest-guest-cart';

interface Purchasable {
  readonly id: string;
  readonly name: string;
  readonly available: number;
}

/**
 * Two comfortably in-stock products from the seeded catalogue.
 *
 * The exact stock comes from the DETAIL endpoint: the public list deliberately
 * reports only `IN_STOCK` / `LOW_STOCK` / `OUT_OF_STOCK` and never the number,
 * so a list response cannot tell this test whether a merge of three units will
 * be clamped. Clamping is asserted deliberately in its own case; an accidental
 * clamp anywhere else would read as a merge bug.
 */
async function purchasables(request: APIRequestContext): Promise<Purchasable[]> {
  const listed = await request.get(`${API}/products?inStock=true&limit=20`);
  expect(listed.ok()).toBe(true);

  const { data } = (await listed.json()) as { data: { slug: string }[] };
  const found: Purchasable[] = [];

  for (const { slug } of data) {
    if (found.length === 2) break;

    const detail = await request.get(`${API}/products/${slug}`);
    if (!detail.ok()) continue;

    const product = ((await detail.json()) as {
      data: { id: string; name: string; stockOnHand: number };
    }).data;

    if (product.stockOnHand >= 12) {
      found.push({ id: product.id, name: product.name, available: product.stockOnHand });
    }
  }

  expect(found.length).toBe(2);

  return found;
}

interface Account {
  readonly email: string;
  /** Access token, for the direct API assertions. */
  readonly token: string;
  /** Refresh token, because the storefront's guard reads `nest_rt`. */
  readonly refreshToken: string;
}

/** A verified account, created through the API rather than the UI. */
async function createAccount(request: APIRequestContext, label: string): Promise<Account> {
  const email = `${E2E_EMAIL_PREFIX}.${label}-${randomUUID().slice(0, 8)}@example.test`;

  const registered = await request.post(`${API}/auth/register`, {
    data: { email, password: PASSWORD, fullName: 'Guest Cart Customer' },
  });
  expect(registered.status()).toBe(201);

  const login = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(200);

  const body = (await login.json()) as {
    data: { accessToken: string; refreshToken: string };
  };

  return { email, token: body.data.accessToken, refreshToken: body.data.refreshToken };
}

/** The server cart as `{ productId: quantity }`. */
async function serverCart(
  request: APIRequestContext,
  token: string,
): Promise<Record<string, number>> {
  const response = await request.get(`${API}/cart`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as {
    data: { items: { productId: string; quantity: number }[] };
  };

  return Object.fromEntries(body.data.items.map((line) => [line.productId, line.quantity]));
}

async function addToServerCart(
  request: APIRequestContext,
  token: string,
  productId: string,
  quantity: number,
): Promise<void> {
  const response = await request.post(`${API}/cart/items`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { productId, quantity },
  });
  expect(response.ok()).toBe(true);
}

/**
 * Writes the guest basket into `localStorage` before the app boots.
 *
 * `addInitScript` rather than an `evaluate` after navigation: the store
 * rehydrates during the first render, and a value written afterwards would be
 * overwritten by the empty state it already read.
 */
async function seedGuestCart(
  page: Page,
  items: { productId: string; quantity: number }[],
  pendingMerge: { productId: string; quantity: number }[] | null = null,
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [STORE_KEY, JSON.stringify({ state: { items, pendingMerge }, version: 0 })] as const,
  );
}

/**
 * Installs the session the sign-in form would have written.
 *
 * The names and flags mirror `lib/api/session.ts` exactly — httpOnly, lax,
 * path `/`, insecure on local http. If that module ever renames a cookie, every
 * case using this fails together, which is the right way for a stand-in to
 * break.
 */
async function signInWithCookies(context: BrowserContext, session: Account): Promise<void> {
  await context.addCookies([
    {
      name: 'nest_at',
      value: session.token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'nest_rt',
      value: session.refreshToken,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/** Lands on an authenticated page, which is what mounts the merge. */
async function openShop(page: Page): Promise<void> {
  await page.goto('/shop');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/**
 * Signs in through the real form, on the CANONICAL page.
 *
 * It used to drive `/shop/login` and wait for `/shop`. The T2 flip moved the
 * implementation to `/login`, and a successful sign-in with no `?redirect=`
 * lands on the account area — which is also a signed-in page, so the merge
 * mounts there just as it did on `/shop`.
 */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  // `exact`: the reveal toggle beside the input is labelled "Show password".
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/account/orders');
}

/** The merge runs on mount and is asynchronous; wait for the basket to empty. */
async function waitForMerge(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((key) => {
          const raw = window.localStorage.getItem(key);
          if (raw === null) return 0;

          const parsed = JSON.parse(raw) as { state?: { items?: unknown[] } };
          return parsed.state?.items?.length ?? 0;
        }, STORE_KEY),
      { timeout: 20_000, message: 'the guest basket was never emptied by the merge' },
    )
    .toBe(0);
}

let first: Purchasable;
let second: Purchasable;
let account: Account;

test.beforeAll(async ({ request }) => {
  [first, second] = await purchasables(request);
  account = await createAccount(request, 'guest-cart');
});

test.beforeEach(async ({ request }) => {
  // Each case declares its own starting cart, so it starts from nothing.
  const cleared = await request.delete(`${API}/cart`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  expect(cleared.ok()).toBe(true);
});

test('a guest basket merges into an EMPTY account cart, through a real sign-in', async ({
  page,
  request,
}) => {
  /*
   * The one case that drives the sign-in FORM. Everything below installs the
   * session cookies directly, so this is what proves the merge is actually
   * triggered by logging in rather than by the way the other cases arrive.
   */
  await seedGuestCart(page, [
    { productId: first.id, quantity: 2 },
    { productId: second.id, quantity: 1 },
  ]);

  await signIn(page, account.email);
  await waitForMerge(page);

  // Line by line, from the API.
  expect(await serverCart(request, account.token)).toEqual({
    [first.id]: 2,
    [second.id]: 1,
  });
});

test('a guest basket UNIONS with different items already in the account', async ({
  page,
  context,
  request,
}) => {
  // The account already holds a DIFFERENT product.
  await addToServerCart(request, account.token, second.id, 4);

  await seedGuestCart(page, [{ productId: first.id, quantity: 3 }]);

  await signInWithCookies(context, account);
  await openShop(page);
  await waitForMerge(page);

  // Both survive, and the untouched line keeps its exact quantity — the plan
  // never mentions it, so nothing can rewrite it.
  expect(await serverCart(request, account.token)).toEqual({
    [first.id]: 3,
    [second.id]: 4,
  });
});

test('the SAME product in both is SUMMED, not replaced', async ({ page, context, request }) => {
  const product = first;

  await addToServerCart(request, account.token, product.id, 3);
  await seedGuestCart(page, [{ productId: product.id, quantity: 2 }]);

  await signInWithCookies(context, account);
  await openShop(page);
  await waitForMerge(page);

  /*
   * 5. Not 3 (server wins), not 2 (guest wins), not 6 (double-applied).
   * Each of those wrong answers is a different bug, and only this assertion
   * tells them apart.
   */
  expect(await serverCart(request, account.token)).toEqual({ [product.id]: 5 });
});

test('a quantity beyond stock is CLAMPED, and the customer is told', async ({
  page,
  context,
  request,
}) => {
  const product = first;

  // Ask for far more than exists. The API clamps to `min(99, onHand)`.
  await seedGuestCart(page, [{ productId: product.id, quantity: 99 }]);
  await addToServerCart(request, account.token, product.id, 1);

  await signInWithCookies(context, account);
  await openShop(page);
  await waitForMerge(page);

  const cart = await serverCart(request, account.token);

  expect(cart[product.id]).toBe(Math.min(99, product.available));
  expect(cart[product.id]).toBeLessThan(100);

  // Never silent. A basket that quietly shrinks between signing in and checking
  // out is a customer who finds out at the payment screen.
  await expect(page.getByTestId('guest-cart-merge-notice')).toBeVisible();
  await expect(page.getByTestId('guest-cart-merge-notice')).toContainText('in stock');
});

test('an unpurchasable line is skipped, the rest merge, and sign-in still works', async ({
  page,
  context,
  request,
}) => {
  const product = first;

  /*
   * A well-formed product id that no product has. That is exactly what a
   * deleted product looks like to a basket that has been sitting in
   * `localStorage` for a month.
   */
  const ghost = '68b000000000000000000999';

  await seedGuestCart(page, [
    { productId: product.id, quantity: 2 },
    { productId: ghost, quantity: 1 },
  ]);

  await signInWithCookies(context, account);
  await openShop(page);
  await waitForMerge(page);

  // The good line merged; the dead one did not block it, and did not block the
  // sign-in either — the page below is a signed-in page.
  expect(await serverCart(request, account.token)).toEqual({ [product.id]: 2 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  await expect(page.getByTestId('guest-cart-merge-notice')).toBeVisible();
  await expect(page.getByTestId('guest-cart-merge-notice')).toContainText('no longer available');
});

test('a merge INTERRUPTED part-way and retried does not double anything', async ({
  page,
  context,
  request,
  health,
}) => {
  /*
   * THE case. Everything else is arithmetic; this is the one that costs a
   * customer money if it is wrong.
   *
   * The interruption is real: the second server-action POST — the one that
   * writes — is aborted at the network layer. The first (the read-only plan)
   * is allowed through, so the plan is frozen in `localStorage` exactly as it
   * would be in production, and the write may or may not have reached the API.
   *
   * The retry then re-applies THOSE targets. Because they are absolute and
   * frozen, the answer is the same whether the aborted write landed or not.
   */
  const product = first;

  await addToServerCart(request, account.token, product.id, 3);
  await seedGuestCart(page, [{ productId: product.id, quantity: 2 }]);

  // Aborting a request the page is awaiting produces a console error. That is
  // the point of the test, not a symptom.
  health.allowConsoleError(/Failed to (load resource|fetch)|net::ERR_FAILED/);

  /**
   * Kills the WRITE, identified by what it carries rather than by its position.
   *
   * This used to abort "the second server action", which was true when the page
   * fired exactly two. It is not true any more: the header prices the basket
   * through a server action of its own on every signed-in render, so an ordinal
   * now kills whichever action happens to be second — sometimes the read.
   *
   * The frozen TARGET is the discriminator, and it is a meaningful one. The
   * basket holds 2 and the account cart holds 3, so the plan and the cart read
   * both carry 2 while the apply carries the summed target of 5. Aborting on
   * the target quantity is therefore precisely "kill the write", stated in the
   * terms the test is about.
   */
  const TARGET = 5;

  await page.route('**/*', async (route) => {
    const request_ = route.request();
    const isServerAction =
      request_.method() === 'POST' && request_.headers()['next-action'] !== undefined;

    if (!isServerAction) {
      await route.continue();
      return;
    }

    const body = request_.postData() ?? '';
    const carriesTarget =
      body.includes(product.id) && body.includes(`"quantity":${String(TARGET)}`);

    if (carriesTarget) {
      await route.abort('failed');
      return;
    }

    await route.continue();
  });

  await signInWithCookies(context, account);
  await openShop(page);

  /*
   * The plan was frozen and the write was interrupted, so the basket is still
   * there — nothing is cleared until the API confirms.
   *
   * Polled rather than read once: the freeze happens between the two actions,
   * and asserting on a single read would be a race with the page rather than a
   * statement about it.
   */
  const readFrozen = async (): Promise<unknown> =>
    page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw === null
        ? null
        : (JSON.parse(raw) as { state: { pendingMerge: unknown[] | null } }).state.pendingMerge;
    }, STORE_KEY);

  await expect
    .poll(readFrozen, {
      timeout: 20_000,
      message: 'the plan was never frozen before the write',
    })
    .toEqual([{ productId: product.id, quantity: TARGET }]);

  // --- the retry -----------------------------------------------------------
  await page.unroute('**/*');
  await page.goto('/shop');
  await waitForMerge(page);

  /*
   * 5, whatever happened to the aborted write.
   *
   * If it never reached the API, the retry applied 5. If it did, the retry
   * patched 5 to 5. The frozen plan is what makes those two the same number —
   * a re-planned merge would have read 5 and asked for 7.
   */
  expect(await serverCart(request, account.token)).toEqual({ [product.id]: 5 });
});

test('a merge whose plan was already applied is not applied twice', async ({
  page,
  context,
  request,
}) => {
  /*
   * The same guarantee, reconstructed deterministically rather than by racing a
   * network abort: the state an interrupted merge leaves behind is a frozen
   * plan plus a server cart that may already satisfy it.
   *
   * This is the case where the write DID land and the response was lost — the
   * one a network abort cannot reliably produce, and the one that doubles a
   * basket if the plan is recomputed.
   */
  const product = first;

  // The world as it is after a lost response: the cart already holds the target.
  await addToServerCart(request, account.token, product.id, 5);

  await seedGuestCart(
    page,
    [{ productId: product.id, quantity: 2 }],
    [{ productId: product.id, quantity: 5 }],
  );

  await signInWithCookies(context, account);
  await openShop(page);
  await waitForMerge(page);

  // Still 5. A recomputed plan would have made it 7.
  expect(await serverCart(request, account.token)).toEqual({ [product.id]: 5 });
});

test('the merged cart is what the cart PAGE shows', async ({ page, context }) => {
  // The API assertions above prove the cart. This proves the wiring: the page a
  // customer actually lands on reflects it, priced by the API.
  const product = first;

  await seedGuestCart(page, [{ productId: product.id, quantity: 2 }]);

  await signInWithCookies(context, account);
  await openShop(page);
  await waitForMerge(page);

  await page.goto('/shop/cart');

  await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible();
  await expect(page.getByText(product.name, { exact: false }).first()).toBeVisible();
});
