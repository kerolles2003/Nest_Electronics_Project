/**
 * The stable vocabulary of audited actions.
 *
 * Authority: docs/architecture/AUDIT-MODEL.md §3 (what is audited) and §4
 * (`action` is a stable enum, queryable).
 *
 * ## Stable means these strings are data, not labels
 *
 * They are written into `auditLogs` and kept for two years, so renaming one
 * orphans every record already written under the old name. Add; do not rename.
 *
 * ## Not everything is here, deliberately
 *
 * §3 is explicit that auditing reads, or every write, drowns the signal. The
 * test it gives is whether an investigator or a regulator would ask *who did
 * this*. Product description edits, customer cart changes and successful
 * customer logins are all excluded by that test and are excluded here.
 */
export enum AuditAction {
  // ---- Order interventions (§3) -----------------------------------------
  /**
   * An operator moved an order through the lifecycle.
   *
   * This is the one that was missing. `statusHistory` records the same event as
   * BUSINESS history — customer-visible, embedded, answering "what happened to
   * this order". §1 is explicit that the two are different records answering
   * different questions and must not share a mechanism, and §3 lists admin
   * status transitions as audited. Recording only the first left every
   * intervention since Phase 6 unaudited in the security sense.
   */
  ORDER_STATUS_CHANGED = 'ORDER_STATUS_CHANGED',
  ORDER_PAYMENT_CHANGED = 'ORDER_PAYMENT_CHANGED',

  // ---- Money-affecting catalogue changes (§3) ----------------------------
  PRODUCT_PRICE_CHANGED = 'PRODUCT_PRICE_CHANGED',
  PRODUCT_CREATED = 'PRODUCT_CREATED',
  PRODUCT_UPDATED = 'PRODUCT_UPDATED',

  // ---- Publication state (§3) -------------------------------------------
  PRODUCT_PUBLISHED = 'PRODUCT_PUBLISHED',
  PRODUCT_UNPUBLISHED = 'PRODUCT_UNPUBLISHED',

  // ---- Destructive operations (§3) --------------------------------------
  PRODUCT_DELETED = 'PRODUCT_DELETED',
  CATEGORY_CREATED = 'CATEGORY_CREATED',
  CATEGORY_UPDATED = 'CATEGORY_UPDATED',
  CATEGORY_DELETED = 'CATEGORY_DELETED',
  BRAND_CREATED = 'BRAND_CREATED',
  BRAND_UPDATED = 'BRAND_UPDATED',
  BRAND_DELETED = 'BRAND_DELETED',
  MEDIA_DELETED = 'MEDIA_DELETED',

  // ---- Inventory (§3) ----------------------------------------------------
  /**
   * In ADDITION to the ledger, not instead of it. §3 puts it plainly: the
   * ledger records *what* moved, audit records *who, and why they were allowed
   * to*.
   */
  INVENTORY_ADJUSTED = 'INVENTORY_ADJUSTED',

  // ---- Authorization changes (§3) ---------------------------------------
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',

  // ---- Configuration (§3) ------------------------------------------------
  SHIPPING_RATE_CHANGED = 'SHIPPING_RATE_CHANGED',
}

/** The kinds of thing an audited action can be about. */
export enum AuditEntityType {
  ORDER = 'ORDER',
  PRODUCT = 'PRODUCT',
  CATEGORY = 'CATEGORY',
  BRAND = 'BRAND',
  USER = 'USER',
  MEDIA = 'MEDIA',
  SHIPPING_RATE = 'SHIPPING_RATE',
}
