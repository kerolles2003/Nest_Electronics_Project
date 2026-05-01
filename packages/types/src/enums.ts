export const OrderStatus = {
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
} as const;
export type OrderStatus = typeof OrderStatus[keyof typeof OrderStatus];

export const PaymentStatus = {
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
} as const;
export type PaymentStatus = typeof PaymentStatus[keyof typeof PaymentStatus];

export const FulfillmentStatus = {
  UNFULFILLED: 'unfulfilled',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
} as const;
export type FulfillmentStatus = typeof FulfillmentStatus[keyof typeof FulfillmentStatus];

export const UserRole = {
  CUSTOMER: 'customer',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const;
export type UserRole = typeof UserRole[keyof typeof UserRole];

export const ModerationStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export type ModerationStatus = typeof ModerationStatus[keyof typeof ModerationStatus];

export const InventoryTransactionType = {
  PURCHASE: 'purchase',
  SALE: 'sale',
  RETURN: 'return',
  ADJUSTMENT: 'adjustment',
  RESERVATION: 'reservation',
  RESERVATION_RELEASE: 'reservation_release',
  DAMAGED: 'damaged',
} as const;
export type InventoryTransactionType = typeof InventoryTransactionType[keyof typeof InventoryTransactionType];

export const CompatibilityType = {
  WORKS_WITH: 'works_with',
  REQUIRES: 'requires',
  REPLACES: 'replaces',
  ACCESSORY_FOR: 'accessory_for',
} as const;
export type CompatibilityType = typeof CompatibilityType[keyof typeof CompatibilityType];
