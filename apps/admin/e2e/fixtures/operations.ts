import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page, request } from '@playwright/test';
import { API_BASE_URL, route } from '../origin';
import {
  DEV_ADMIN_EMAIL,
  DEV_ADMIN_NAME,
  DEV_ADMIN_PASSWORD,
  E2E_EMAIL_PREFIX,
} from './accounts';

/**
 * What an admin spec needs: an operator to sign in as, and real orders to work.
 *
 * ## Orders are placed through the API, not typed into the database
 *
 * `placeOrder` registers a customer, saves an address, fills a cart and posts
 * `POST /orders` — the same calls, in the same order, that the storefront's own
 * checkout makes. An order written straight into Mongo would be a guess about
 * what an order looks like, and it would go stale the first time the model
 * changed, silently, because nothing type-checks an `insertOne`.
 *
 * This is the DATA PATH the storefront uses. The storefront's own UI walk is
 * covered by its suite; what these specs prove is that an order created that
 * way is visible to, and operable from, this console.
 */

/*
 * Re-exported for the specs, which read them as the expected on-screen values.
 * Defined in `./accounts.ts` so the teardown can see the same list — see that
 * file for what keeping them here alone cost.
 */
export { DEV_ADMIN_EMAIL, DEV_ADMIN_NAME, DEV_ADMIN_PASSWORD };

/** Long enough for the API's policy, and not a value that appears in the repo twice. */
const CUSTOMER_PASSWORD = 'lithium polymer harness';

export interface PlacedOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly grandTotalFormatted: string;
  readonly customerEmail: string;
}

/**
 * An API context that does NOT use `baseURL`.
 *
 * `API_BASE_URL` carries a path prefix (`/api/v1`), and Playwright resolves a
 * request path against the base URL with `new URL()` — where an absolute path
 * REPLACES the whole path component. `post('/auth/register')` against a base of
 * `http://host:3002/api/v1` therefore hits `http://host:3002/auth/register`,
 * which is a 404 that reads like a missing endpoint.
 *
 * It is the same trap the admin's own `baseURL` has with `basePath` — noted in
 * `playwright.config.ts` — and it caught this fixture too. Every call below
 * builds the full URL with `url()`.
 */
async function api(): Promise<APIRequestContext> {
  return request.newContext();
}

/**
 * Asserts a status and, on failure, says what the API actually answered.
 *
 * A bare `expect(status).toBe(200)` reports "Received: 409" and nothing else,
 * which sends whoever is reading it guessing at which of several conflicts it
 * was. The API's envelope names the code; printing it turns a debugging round
 * into a sentence.
 */
async function expectStatus(
  response: import('@playwright/test').APIResponse,
  status: number,
  what: string,
): Promise<void> {
  if (response.status() === status) return;

  const body = await response.text();

  throw new Error(
    `${what}: expected HTTP ${String(status)}, got ${String(response.status())}
${body.slice(0, 400)}`,
  );
}

/** A full API URL. Never a bare path — see `api()`. */
function url(path: string): string {
  return `${API_BASE_URL}${path}`;
}

/**
 * Signs the operator in through the REAL form.
 *
 * Not by setting a cookie: the cookie is httpOnly and its value is a token this
 * suite has no business minting. Driving the form also means every spec
 * exercises the server action, the API call and the cookie write that a real
 * sign-in does — if any of those breaks, every spec fails rather than one.
 */
export async function signIn(
  page: Page,
  credentials: { email: string; password: string } = {
    email: DEV_ADMIN_EMAIL,
    password: DEV_ADMIN_PASSWORD,
  },
): Promise<void> {
  await page.goto(route('/login'));
  await page.getByLabel('Email Address').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

/** Signs in and waits until the console is actually showing. */
export async function signInAsAdmin(page: Page): Promise<void> {
  await signIn(page);
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 });
}

/**
 * Places one REAL order through the API and returns what the console should
 * show for it.
 *
 * Each call creates its own customer, so orders never collide and a spec that
 * drives one order to a terminal state cannot affect another.
 */
export async function placeOrder(runId: string, label: string): Promise<PlacedOrder> {
  const context = await api();

  try {
    const email = `${E2E_EMAIL_PREFIX}.${label}.${runId}@example.test`;

    const registered = await context.post(url('/auth/register'), {
      data: { email, password: CUSTOMER_PASSWORD, fullName: `Admin E2E ${label}` },
    });
    await expectStatus(registered, 201, 'registering the order’s customer');

    const loggedIn = await context.post(url('/auth/login'), {
      data: { email, password: CUSTOMER_PASSWORD },
    });
    await expectStatus(loggedIn, 200, 'signing that customer in');

    const token = (await loggedIn.json()).data.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    const address = await context.post(url('/users/me/addresses'), {
      headers: auth,
      data: {
        label: 'Home',
        fullName: `Admin E2E ${label}`,
        phone: '01012345678',
        street: '12 Sherif Street, Apartment 4',
        city: 'Downtown',
        governorate: 'Cairo',
      },
    });
    await expectStatus(address, 201, 'saving a delivery address');
    const addressId = (await address.json()).data.id as string;

    /*
     * A real product from the seeded catalogue, chosen by asking the API rather
     * than by hard-coding a slug: a fixed slug is a spec that fails the day the
     * seed changes, for a reason that has nothing to do with the console.
     */
    const products = await context.get(url('/products?limit=24&sort=newest'));
    await expectStatus(products, 200, 'reading the catalogue');

    /*
     * A product that is IN STOCK, not merely the newest.
     *
     * The first version took `?limit=1&sort=newest`, which is the same product
     * on every call — so a run placing a dozen orders of it eventually drained
     * the stock, and every later spec failed with a `409` on the cart, several
     * files away from anything to do with the console. Choosing an available
     * one from a page makes the fixture independent of how many orders the run
     * has already placed.
     */
    const catalogue = (await products.json()).data as {
      id: string;
      availability: string;
    }[];

    const product = catalogue.find((candidate) => candidate.availability === 'IN_STOCK');

    if (product === undefined) {
      throw new Error(
        `No IN_STOCK product among the ${String(catalogue.length)} returned, so no order can ` +
          'be placed.\nRun: pnpm --filter api seed',
      );
    }

    const added = await context.post(url('/cart/items'), {
      headers: auth,
      data: { productId: product.id, quantity: 1 },
    });
    await expectStatus(added, 200, 'adding a line to the cart');

    const placed = await context.post(url('/orders'), {
      /*
       * A UUID, because the API requires one — `Idempotency-Key must be a UUID`.
       * Fresh per call: the key is the thing that makes a RETRY safe, so reusing
       * one across orders would make the second placement a replay of the first
       * and return the wrong order.
       */
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { addressId },
    });
    await expectStatus(placed, 201, 'placing the order');

    const order = (await placed.json()).data as {
      id: string;
      orderNumber: string;
      pricing: { grandTotal: { formatted: string } };
    };

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      grandTotalFormatted: order.pricing.grandTotal.formatted,
      customerEmail: email,
    };
  } finally {
    await context.dispose();
  }
}

/**
 * A signed-in customer with a delivery address in a chosen governorate, and a
 * cart, able to ask for a checkout quote.
 *
 * ## Why the settings suite needs a real customer
 *
 * "Editing a shipping rate changes the next checkout quote" is a claim about
 * two subsystems agreeing, and only a quote can settle it. Reading the rate back
 * from the admin API would prove the console saved something; it would say
 * nothing about whether a customer is charged it.
 *
 * The governorate is a parameter because the order fixtures above use `Cairo`.
 * A spec that edited Cairo's rate would be changing the fee under any order
 * placed beside it, and the failure would surface in the other file.
 */
export async function quotingCustomer(
  runId: string,
  label: string,
  governorate: string,
): Promise<{ quote: () => Promise<{ fee: number; priced: boolean }>; dispose: () => Promise<void> }> {
  const context = await api();
  const email = `${E2E_EMAIL_PREFIX}.${label}.${runId}@example.test`;

  const registered = await context.post(url('/auth/register'), {
    data: { email, password: CUSTOMER_PASSWORD, fullName: `Admin E2E ${label}` },
  });
  await expectStatus(registered, 201, 'registering the quoting customer');

  const loggedIn = await context.post(url('/auth/login'), {
    data: { email, password: CUSTOMER_PASSWORD },
  });
  await expectStatus(loggedIn, 200, 'signing the quoting customer in');

  const token = (await loggedIn.json()).data.accessToken as string;
  const auth = { Authorization: `Bearer ${token}` };

  const address = await context.post(url('/users/me/addresses'), {
    headers: auth,
    data: {
      label: 'Home',
      fullName: `Admin E2E ${label}`,
      phone: '01012345678',
      street: '3 Corniche Road',
      city: 'Centre',
      governorate,
    },
  });
  await expectStatus(address, 201, `saving an address in ${governorate}`);
  const addressId = (await address.json()).data.id as string;

  const products = await context.get(url('/products?limit=24&sort=newest'));
  await expectStatus(products, 200, 'reading the catalogue');

  const catalogue = (await products.json()).data as { id: string; availability: string }[];
  const product = catalogue.find((candidate) => candidate.availability === 'IN_STOCK');

  if (product === undefined) {
    throw new Error('No IN_STOCK product to quote against.\nRun: pnpm --filter api seed');
  }

  const added = await context.post(url('/cart/items'), {
    headers: auth,
    data: { productId: product.id, quantity: 1 },
  });
  await expectStatus(added, 200, 'adding a line to the quoting cart');

  return {
    quote: async () => {
      // Recomputed every request and never cached — the endpoint's own
      // contract — so a second call after an edit is a genuinely fresh answer.
      const response = await context.post(url('/checkout/quote'), {
        headers: auth,
        data: { addressId },
      });
      await expectStatus(response, 200, 'quoting the checkout');

      const body = (await response.json()).data as {
        pricing: { shippingFee: { amount: number }; shippingPriced: boolean };
      };

      return { fee: body.pricing.shippingFee.amount, priced: body.pricing.shippingPriced };
    },
    dispose: () => context.dispose(),
  };
}

/** Registers a CUSTOMER and returns their credentials. For the role tests. */
export async function registerCustomer(
  runId: string,
  label: string,
): Promise<{ email: string; password: string }> {
  const context = await api();

  try {
    const email = `${E2E_EMAIL_PREFIX}.${label}.${runId}@example.test`;

    const registered = await context.post(url('/auth/register'), {
      data: { email, password: CUSTOMER_PASSWORD, fullName: `Customer ${label}` },
    });
    await expectStatus(registered, 201, 'registering a customer');

    return { email, password: CUSTOMER_PASSWORD };
  } finally {
    await context.dispose();
  }
}

/**
 * An API context already carrying an operator's bearer token.
 *
 * ## What it is for, and what it is NOT for
 *
 * The catalogue specs assert on the DATABASE's answer, not on the console's own
 * echo of what it just sent. A page that renders its optimistic local state
 * would satisfy a UI-only assertion perfectly while having written nothing —
 * which is the same class of hollowness as a suite whose React never booted.
 * So each of them drives the browser, then asks the API what is actually there.
 *
 * It is NOT a way to set fixtures up faster than the console can. Anything the
 * screen under test is supposed to create is created BY that screen; this reads.
 * The exception is stated at each call site.
 *
 * The caller disposes it. `test.afterAll` is the usual place.
 */
export async function adminApi(): Promise<APIRequestContext> {
  const context = await request.newContext();

  const loggedIn = await context.post(url('/auth/login'), {
    data: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD },
  });
  await expectStatus(loggedIn, 200, 'signing the development admin in');

  const token = (await loggedIn.json()).data.accessToken as string;

  /*
   * Rebuilt with the header baked in rather than passed at each call. A helper
   * that returns a token invites a call that forgets it, and a forgotten
   * Authorization header is a 401 that reads like a permissions bug.
   */
  await context.dispose();

  return request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

/** The API's full URL for a path, for callers holding an `adminApi()` context. */
export function apiUrl(path: string): string {
  return url(path);
}

/** Reads one order as the API sees it, for asserting against what the UI shows. */
export async function readOrderAsAdmin(orderId: string): Promise<Record<string, unknown>> {
  const context = await api();

  try {
    const loggedIn = await context.post(url('/auth/login'), {
      data: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD },
    });
    await expectStatus(loggedIn, 200, 'signing the development admin in');

    const token = (await loggedIn.json()).data.accessToken as string;

    const order = await context.get(url(`/admin/orders/${orderId}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expectStatus(order, 200, 'reading the order as staff');

    return (await order.json()).data as Record<string, unknown>;
  } finally {
    await context.dispose();
  }
}
