'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, ShoppingBag, Trash2 } from 'lucide-react';
import { ROUTES } from '@nest/config/constants';
import { useCart } from '@/components/cart/CartProvider';
import { cartLineImageUrl } from '@/lib/images';
import { QuantitySelector } from '@/components/QuantitySelector';
import type { CartLine } from '@/lib/api/types';

/**
 * The full-page cart.
 *
 * Reads the same `useCart()` the drawer and the header badge read, so the three
 * cannot disagree — and, like them, it renders the server's figures and adds up
 * nothing. `lineTotal` and `itemsSubtotal` arrive computed and formatted.
 *
 * A flagged line is KEPT and explained rather than removed. A basket that
 * quietly loses an item is a basket the customer stops believing, and the API
 * deliberately returns those lines with a status for exactly this reason.
 */
export function CartView() {
  const { cart, busy, error, setQuantity, remove } = useCart();

  if (cart === null) {
    /*
     * The heading is here too, and that is the point.
     *
     * All three branches below have an `<h1>`; this one did not, so for as long
     * as the cart was loading — which is the whole of the first paint, since
     * `useCart()` fetches after hydration — `/cart` was a document with **no
     * heading at all**. A crawler that does not wait, a heading list, and a
     * screen reader's "jump to first heading" all saw an untitled page, and it
     * is the state the page spends its first second in every single time.
     */
    return (
      <div className="py-16 text-center">
        <h1 className="mb-3 text-3xl font-black uppercase tracking-tight text-foreground">
          Your cart
        </h1>
        <p className="text-foreground-muted" aria-busy="true">
          Loading your cart…
        </p>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-border/50 bg-card p-12 text-center shadow-sm">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-surface">
          <ShoppingBag className="h-12 w-12 text-primary/40" strokeWidth={1.5} />
        </div>
        <h1 className="mb-3 text-3xl font-bold text-foreground">Your cart is empty</h1>
        <p className="mb-8 text-lg text-foreground-muted">
          Add some products and they will appear here.
        </p>
        <Link
          href={ROUTES.products}
          className="block w-full rounded-2xl bg-primary py-4 text-base font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-primary-hover"
        >
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="text-3xl font-black uppercase tracking-tight text-foreground">Your cart</h1>
        <p className="mt-2 text-[13px] font-medium text-foreground-muted">
          {cart.itemCount} {cart.itemCount === 1 ? 'product' : 'products'} · {cart.totalQuantity}{' '}
          {cart.totalQuantity === 1 ? 'unit' : 'units'}
        </p>

        {error !== null && (
          <p role="alert" className="mt-4 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <ul className="mt-6 divide-y divide-[var(--color-border)]" aria-busy={busy}>
          {cart.items.map((line) => (
            <CartRow
              key={line.productId}
              line={line}
              busy={busy}
              onQuantity={(quantity) => void setQuantity(line.productId, quantity)}
              onRemove={() => void remove(line.productId)}
            />
          ))}
        </ul>
      </section>

      <aside className="h-fit rounded-sm border border-[var(--color-border)] bg-white p-6 shadow-sm lg:sticky lg:top-32">
        <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground-muted">
          Summary
        </h2>

        <div className="mt-4 flex items-baseline justify-between">
          <span className="text-sm text-foreground-muted">Subtotal</span>
          <span className="text-xl font-black" data-testid="cart-page-subtotal">
            {cart.itemsSubtotal.formatted}
          </span>
        </div>

        <p className="mt-1 text-xs text-foreground-muted">
          Delivery is calculated at checkout, once you choose an address.
        </p>

        {cart.hasBlockingIssues ? (
          <p role="alert" className="mt-6 text-sm font-medium text-danger">
            Remove the flagged items above before checking out.
          </p>
        ) : (
          <Link
            href={ROUTES.checkout}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-[13px] font-bold uppercase tracking-widest text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-hover"
          >
            Checkout
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}

        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-foreground-muted">
          <ShieldCheck className="h-3.5 w-3.5" />
          Cash on delivery — nothing is charged now.
        </p>
      </aside>
    </div>
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

function CartRow({
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
    <li className="flex gap-4 py-5" data-testid="cart-page-line" data-product-id={line.productId}>
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-[var(--color-border)] bg-surface">
        {image === null ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-foreground-subtle">
            No Image
          </div>
        ) : (
          <Image src={image} alt={line.name} fill sizes="80px" className="object-contain p-1" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/products/${line.slug}`}
              className="font-bold text-foreground hover:underline"
            >
              {line.name}
            </Link>
            <p className="text-xs text-foreground-muted">{line.sku}</p>
            {notice !== null && (
              <p className="mt-1 text-xs font-medium text-amber-700">{notice}</p>
            )}
          </div>

          <div className="text-right">
            <p className="font-black text-foreground">{line.lineTotal.formatted}</p>
            <p className="text-xs text-foreground-muted">{line.unitPrice.formatted} each</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <QuantitySelector
            quantity={line.quantity}
            onIncrease={() => {
              onQuantity(line.quantity + 1);
            }}
            onDecrease={() => {
              onQuantity(line.quantity - 1);
            }}
            max={line.availableQuantity > 0 ? line.availableQuantity : line.quantity}
          />
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-foreground-muted transition-colors hover:text-danger disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
