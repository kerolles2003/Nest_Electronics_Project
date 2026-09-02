'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, ShoppingBag, Trash2, X } from 'lucide-react';
import { useCart } from '@/components/cart/CartProvider';
import { cartLineImageUrl } from '@/lib/images';
import { useUIStore } from '@/stores/ui-store';
import { QuantitySelector } from './QuantitySelector';
import type { CartLine } from '@/lib/api/types';

/**
 * The basket, drawn from the server's answer.
 *
 * Every figure here — unit price, line total, subtotal — is the API's, for a
 * visitor and a customer alike. Nothing is multiplied client-side, because a
 * total computed in two places is a total that eventually disagrees with
 * itself, and the one the customer trusts is the one checkout charges.
 *
 * ## Lines the server has flagged
 *
 * The API keeps a line whose product went out of stock or was delisted rather
 * than deleting it, and says so per line. That is shown here rather than
 * hidden: a basket that quietly loses an item is a basket the customer stops
 * believing. `effectiveQuantity` — not `quantity` — is what will actually be
 * ordered when the two differ, so it is what the notice states.
 */
export function CartDrawer() {
  const { isCartOpen, closeCart } = useUIStore();
  const { cart, busy, error, setQuantity, remove } = useCart();

  if (!isCartOpen) return null;

  const lines = cart?.items ?? [];

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-50 animate-in fade-in duration-200"
        onClick={closeCart}
      />

      <div
        role="dialog"
        aria-label="Your cart"
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-card shadow-2xl z-50 flex flex-col animate-in slide-in-from-right-full duration-300 ease-out"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            Your Cart
            {lines.length > 0 && (
              <span className="text-sm font-normal text-foreground-muted">
                ({lines.length} {lines.length === 1 ? 'item' : 'items'})
              </span>
            )}
          </h2>
          <button
            onClick={closeCart}
            className="p-2 rounded-full hover:bg-accent transition-colors"
            aria-label="Close cart"
          >
            <X className="w-5 h-5 text-foreground-muted" />
          </button>
        </div>

        {error !== null && (
          <p role="alert" className="px-5 py-3 text-sm text-danger border-b border-[var(--color-border)]">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto" aria-busy={busy}>
          {cart === null ? (
            <p className="p-6 text-sm text-foreground-muted">Loading your cart…</p>
          ) : lines.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-foreground-muted px-6 py-12">
              <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center mb-4">
                <ShoppingBag className="w-8 h-8 text-foreground-subtle" />
              </div>
              <p className="text-foreground font-medium text-sm">Your cart is empty</p>
              <p className="text-foreground-muted text-xs mt-1 mb-6 text-center">
                Add items to get started
              </p>
              <button
                onClick={closeCart}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 border border-[var(--color-border)] text-foreground rounded-md hover:bg-accent text-sm font-medium transition-colors"
              >
                Continue Shopping
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {lines.map((line) => (
                <CartDrawerLine
                  key={line.productId}
                  line={line}
                  busy={busy}
                  onQuantity={(quantity) => void setQuantity(line.productId, quantity)}
                  onRemove={() => void remove(line.productId)}
                />
              ))}
            </div>
          )}
        </div>

        {cart !== null && lines.length > 0 && (
          <div className="border-t border-[var(--color-border)] px-5 py-4 space-y-3 bg-surface">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground-muted">Subtotal</span>
              <span className="text-lg font-bold text-foreground" data-testid="drawer-subtotal">
                {cart.itemsSubtotal.formatted}
              </span>
            </div>
            <p className="text-xs text-foreground-muted">
              Delivery is calculated at checkout, once you choose an address.
            </p>

            {cart.hasBlockingIssues ? (
              <p role="alert" className="text-sm font-medium text-danger">
                Remove the flagged items above before checking out.
              </p>
            ) : (
              <Link href="/checkout" onClick={closeCart} className="block">
                <button className="w-full bg-primary text-primary-foreground py-3 rounded-md font-semibold hover:bg-primary-hover transition-colors flex items-center justify-center gap-2 active:scale-[0.98]">
                  Proceed to Checkout
                  <ArrowRight className="w-4 h-4" />
                </button>
              </Link>
            )}

            <div className="flex items-center justify-center gap-1.5 text-xs text-foreground-muted">
              <ShieldCheck className="w-3.5 h-3.5" />
              Secure checkout
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** What the API says about a line that is not simply `OK`. */
function lineNotice(line: CartLine): string | null {
  switch (line.status) {
    case 'OK':
      return null;
    case 'PRICE_CHANGED':
      return `Price changed — now ${line.unitPrice.formatted}`;
    case 'REDUCED_STOCK':
      return `Only ${String(line.availableQuantity)} left — ${String(line.effectiveQuantity)} will be ordered`;
    case 'OUT_OF_STOCK':
      return 'Out of stock — remove it to continue';
    case 'UNAVAILABLE':
      return 'No longer available — remove it to continue';
  }
}

function CartDrawerLine({
  line,
  busy,
  onQuantity,
  onRemove,
}: {
  line: CartLine;
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const notice = lineNotice(line);
  const image = cartLineImageUrl(line.imagePublicId);

  return (
    <div className="flex gap-3 px-5 py-4" data-testid="cart-line" data-product-id={line.productId}>
      <div className="w-16 h-16 bg-surface rounded-md border border-[var(--color-border)] flex-shrink-0 relative overflow-hidden">
        {image === null ? (
          <div className="absolute inset-0 flex items-center justify-center text-foreground-subtle text-xs">
            No Image
          </div>
        ) : (
          <Image src={image} alt={line.name} fill sizes="64px" className="object-contain p-1" />
        )}
      </div>

      <div className="flex-1 flex flex-col justify-between min-w-0">
        <div>
          <div className="flex justify-between items-start gap-2">
            <Link
              href={`/products/${line.slug}`}
              className="text-sm font-medium text-foreground line-clamp-2 hover:underline"
            >
              {line.name}
            </Link>
            <button
              onClick={onRemove}
              disabled={busy}
              className="text-foreground-muted hover:text-danger p-0.5 flex-shrink-0 transition-colors disabled:opacity-40"
              aria-label={`Remove ${line.name}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-sm text-primary font-semibold mt-0.5">{line.unitPrice.formatted}</p>
          {notice !== null && (
            <p className="mt-1 text-xs font-medium text-amber-700">{notice}</p>
          )}
        </div>

        <div className="flex items-center justify-between mt-2">
          <QuantitySelector
            quantity={line.quantity}
            onIncrease={() => {
              onQuantity(line.quantity + 1);
            }}
            onDecrease={() => {
              onQuantity(line.quantity - 1);
            }}
            /*
             * The API is what actually clamps, and it does so against stock read
             * at the moment of the write. This bound only stops the obvious
             * pointless request; it is not the guard, and the response is still
             * what decides the quantity.
             */
            max={line.availableQuantity > 0 ? line.availableQuantity : line.quantity}
          />
          <span className="text-sm font-semibold text-foreground">{line.lineTotal.formatted}</span>
        </div>
      </div>
    </div>
  );
}
