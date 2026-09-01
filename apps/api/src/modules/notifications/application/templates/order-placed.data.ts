/**
 * Data contract for `orders/order-placed`.
 *
 * Authority: docs/architecture/TEMPLATE-ARCHITECTURE.md §5;
 *            docs/architecture/ORDER-LIFECYCLE.md §12 (→ PLACED, customer:
 *            "Order received, number, items, total, COD amount due").
 *
 * Every money value is a PRE-FORMATTED string produced by `MoneyDto`, the same
 * formatter the API uses on the wire. A template cannot compute a total, so
 * the figure in the email and the figure on the order page are the same
 * expression evaluated once — they cannot drift.
 *
 * `productId`, `sku`, `userId`, `idempotencyKey` and the status history are
 * all absent: none of them is something a customer reads.
 */
export interface OrderPlacedData {
  readonly customerName: string;
  readonly orderNumber: string;
  readonly placedAt: string;
  readonly status: string;

  readonly items: readonly OrderPlacedItem[];

  readonly itemsSubtotal: string;
  readonly discountTotal: string;
  /** Null when no discount applies, so the template can omit the row entirely. */
  readonly hasDiscount: boolean;
  readonly shippingFee: string;
  /** True when delivery has not been priced yet — the flat fee is still 0. */
  readonly shippingUnpriced: boolean;
  readonly grandTotal: string;

  readonly paymentMethod: string;
  /** Cash to have ready on the doorstep. Equals the grand total under COD. */
  readonly amountDueOnDelivery: string;

  readonly shippingAddress: OrderPlacedAddress;
  readonly orderUrl: string;
}

export interface OrderPlacedItem {
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
}

export interface OrderPlacedAddress {
  readonly fullName: string;
  readonly phone: string;
  readonly street: string;
  readonly city: string;
  readonly governorate: string;
  readonly postalCode: string | null;
}
