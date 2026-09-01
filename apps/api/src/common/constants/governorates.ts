/**
 * The 27 governorates of Egypt — the ONLY values an address may carry.
 *
 * ## Why this is a closed list now, when it deliberately was not before
 *
 * `address-request.dto.ts` used to accept free text, and said why: the
 * governorate vocabulary belonged to the shipping rate table, which was
 * unresolved business input (OPEN-001), and constraining it to a guessed list
 * would have rejected valid addresses.
 *
 * **D-8 resolved that.** The rate table is `shippingRates`, keyed one row per
 * governorate, seeded with all 27 and **no default or fallback row** — so a
 * lookup miss must RAISE rather than invent a fee. That design is only safe if
 * a miss is impossible, and a miss is only impossible if the governorate on the
 * address is guaranteed to be one of these. Free text would mean a customer
 * could type "Cairo " or "cairo" or "Kairo" and reach a rate lookup with
 * nothing to find, at checkout, with an order half-placed.
 *
 * The list is therefore not a convenience or a UI nicety. It is the precondition
 * that makes Phase 5's no-fallback rate table safe, and it belongs on the
 * server, because a client-side `<select>` is a suggestion and not a guarantee.
 *
 * ## Why this is a copy rather than an import
 *
 * The same list exists in `packages/config` (`EGYPTIAN_GOVERNORATES`), which the
 * storefront uses to build its dropdown. `apps/api` deliberately has **zero
 * workspace-package dependencies** — a property worth keeping, and not one to
 * spend on a string array — so importing it would be a real architectural
 * change for a small gain.
 *
 * Duplication is only acceptable when drift is impossible, so
 * `governorates.spec.ts` reads `packages/config/src/constants.ts` and fails if
 * the two lists differ in content or order. Neither side gains a dependency;
 * neither side can drift silently.
 */
export const EGYPTIAN_GOVERNORATES = [
  'Cairo',
  'Giza',
  'Alexandria',
  'Dakahlia',
  'Red Sea',
  'Beheira',
  'Fayoum',
  'Gharbia',
  'Ismailia',
  'Menofia',
  'Minya',
  'Qaliubiya',
  'New Valley',
  'Suez',
  'Aswan',
  'Assiut',
  'Beni Suef',
  'Port Said',
  'Damietta',
  'Sharkia',
  'South Sinai',
  'Kafr El Sheikh',
  'Matrouh',
  'Luxor',
  'Qena',
  'North Sinai',
  'Sohag',
] as const;

export type EgyptianGovernorate = (typeof EGYPTIAN_GOVERNORATES)[number];

/**
 * A mutable copy for `class-validator`'s `@IsIn`, which takes `readonly any[]`
 * but is typed for a plain array.
 */
export const GOVERNORATE_VALUES: string[] = [...EGYPTIAN_GOVERNORATES];
