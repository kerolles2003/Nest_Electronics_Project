/**
 * What the sandbox account is, with no code that does anything.
 *
 * Separated from `sandbox.seed.ts` for the same reason `catalog.seed-data.ts`
 * is separated from `seed.ts`: the seed is a SCRIPT — it ends in `void main()`
 * — so importing it to read a constant runs it. A test that wants to check the
 * documented credentials against the seeded ones must be able to read them
 * without connecting to a database and placing an order.
 */

/**
 * The documented credentials.
 *
 * A development fixture on a local database, not a secret: the whole point is
 * that they are written down, in `docs/api/SANDBOX.md`, and that both places
 * say the same thing — which `test/database/sandbox-seed.spec.ts` asserts. The
 * production guard in the seed is what keeps them local.
 */
export const SANDBOX_EMAIL = 'sandbox@nest-electronics.test';

/** Long enough for the real policy, and memorable enough to type twice. */
export const SANDBOX_PASSWORD = 'brass thermionic valve';

export const SANDBOX_FULL_NAME = 'Sandbox Customer';
export const SANDBOX_PHONE = '01012345678';

export interface SandboxAddress {
  readonly label: string;
  readonly fullName: string;
  readonly phone: string;
  readonly street: string;
  readonly city: string;
  readonly governorate: string;
  readonly postalCode: string | null;
  readonly makeDefault: boolean;
}

/**
 * Two addresses, on purpose, in two different rate bands.
 *
 * D-8 charges 50.00 EGP inside Cairo and Giza and 100.00 EGP everywhere else. A
 * developer with one address cannot see that the fee moves, cannot tell a quote
 * that priced shipping from one that did not, and will hard-code whichever
 * number they happened to see. Two addresses make the rule visible on the first
 * afternoon.
 */
export const SANDBOX_ADDRESSES: readonly SandboxAddress[] = [
  {
    label: 'Home',
    fullName: SANDBOX_FULL_NAME,
    phone: SANDBOX_PHONE,
    street: '12 Sherif Street, Apartment 4',
    city: 'Downtown',
    governorate: 'Cairo',
    postalCode: '11511',
    makeDefault: true,
  },
  {
    label: 'Work',
    fullName: SANDBOX_FULL_NAME,
    phone: SANDBOX_PHONE,
    street: '3 El Geish Road, Floor 2',
    city: 'Sidi Gaber',
    governorate: 'Alexandria',
    postalCode: '21500',
    makeDefault: false,
  },
];

/** The label of the address the seeded order ships to. */
export const SANDBOX_DEFAULT_ADDRESS_LABEL = 'Home';

export interface SandboxLine {
  readonly slug: string;
  readonly quantity: number;
}

/** What the resting cart holds. Two lines, so a badge and a subtotal are both non-trivial. */
export const SANDBOX_CART: readonly SandboxLine[] = [
  { slug: 'raspberry-pi-pico-2-w', quantity: 2 },
  { slug: 'bme280-pressure-sensor', quantity: 1 },
];

/** What the one historical order bought. Different products, so the two are told apart. */
export const SANDBOX_ORDER: readonly SandboxLine[] = [
  { slug: 'esp32-devkit-v1', quantity: 1 },
  { slug: 'hc-sr04-ultrasonic-sensor', quantity: 3 },
];
