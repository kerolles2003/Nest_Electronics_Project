/**
 * Every template the application can render.
 *
 * The id mirrors the file path under `src/templates/email/<locale>/`, so an id
 * in a service leads directly to the file
 * (TEMPLATE-ARCHITECTURE.md §10).
 *
 * A closed union, not a string: a typo is then a compile error rather than a
 * runtime "template not found" discovered by a customer who received nothing.
 * The inventory test asserts that every member has both an `.hbs` and a
 * `.txt.hbs` file, so a renamed file fails CI instead of production.
 *
 * SCOPE. The frozen inventory is 14 templates covering the full order
 * lifecycle and auth surface (TEMPLATE-ARCHITECTURE.md §3). Three exist here,
 * because three business events currently dispatch mail. Adding the rest is one
 * union member, two files and one service method each — the pipeline does not
 * change. Listing ids for templates nothing sends would produce exactly the
 * dead configuration this codebase keeps removing.
 */
export const TEMPLATE_IDS = [
  'auth/verify-email',
  'auth/password-reset',
  'orders/order-placed',
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];
