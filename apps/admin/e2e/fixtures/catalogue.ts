/**
 * The CATALOGUE namespace this suite owns, and the API calls that work inside
 * it.
 *
 * ## Why a namespace was needed before a single catalogue spec could be written
 *
 * `global-teardown.ts` does not report what it cleaned and stop there — it
 * compares the database against the state preparation recorded: every
 * collection's document count, and every product's `stock.onHand` per SKU. A
 * spec that creates a product and does not remove it does not leave residue
 * quietly; it fails the run, by name, which is the behaviour that was wanted.
 *
 * The existing teardown knew about accounts, orders, sessions and audit rows,
 * because those were the only things the suite made. Catalogue specs make
 * products, categories, brands and media assets, and they are made by the
 * SEEDED OPERATOR rather than by a namespaced account — so there is no email
 * prefix to find them by. This module is the identity they get instead.
 *
 * ## Fixed, not per-run
 *
 * Same reasoning as `E2E_EMAIL_PREFIX`: a crashed run's residue is collected by
 * the NEXT run rather than orphaned forever. A per-run suffix still goes inside
 * the prefix, so two runs cannot collide on a unique SKU.
 */

/** Every SKU this suite creates. Uppercase, because SKUs are. */
export const E2E_SKU_PREFIX = 'ADMIN-E2E-';

/** Every slug this suite creates — products, categories and brands alike. */
export const E2E_SLUG_PREFIX = 'admin-e2e-';

/**
 * Every NAME this suite creates.
 *
 * Names are not unique and nothing keys on them, so this is for the human
 * reading a half-cleaned database rather than for the teardown. It is also what
 * a spec asserts on, since a name is what the console shows.
 */
export const E2E_NAME_PREFIX = 'Admin E2E ';

/**
 * Media assets are found through their PRODUCT, not by a prefix of their own.
 *
 * The API generates `nest/products/<productId>/<random>` and the client never
 * chooses it — see `in-memory-media-storage.ts`. That is better than a prefix
 * would be: the product id is exact, so the teardown removes the assets of the
 * products it is removing and cannot touch anybody else's.
 */
export const MEDIA_PREFIX_FOR_PRODUCT = (productId: string): string =>
  `nest/products/${productId}/`;
