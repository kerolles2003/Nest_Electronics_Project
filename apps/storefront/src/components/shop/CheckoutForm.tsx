'use client';

import { useRouter } from 'next/navigation';
import { useActionState } from 'react';
import { placeOrderAction } from '@/actions/api-shop.actions';
import { emptyActionState } from '@/lib/api/action-state';
import type { Address, CheckoutQuote } from '@/lib/api/types';

/**
 * The checkout screen.
 *
 * Every amount rendered is the server's own `formatted` string. This component
 * adds nothing up: `grandTotal` is what the customer pays and it arrives
 * computed. `canPlaceOrder` is likewise the server's decision — an empty cart
 * and a delisted line are different reasons for the same disabled button, and
 * the server owns both rules.
 */
export function CheckoutForm({
  addresses,
  selectedId,
  quote,
  idempotencyKey,
}: {
  addresses: Address[];
  selectedId: string;
  quote: CheckoutQuote;
  idempotencyKey: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(placeOrderAction, emptyActionState);

  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight">Checkout</h1>

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-black/60">Deliver to</h2>
        <div className="mt-2 space-y-2">
          {addresses.map((address) => (
            <label
              key={address.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-black/10 p-3 text-sm"
            >
              <input
                type="radio"
                name="addressChoice"
                defaultChecked={address.id === selectedId}
                onChange={() => router.replace(`/shop/checkout?address=${address.id}`)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{address.label}</span>
                {address.isDefault ? (
                  <span className="ml-2 text-xs text-black/50">(default)</span>
                ) : null}
                <span className="block text-black/70">
                  {address.fullName} · {address.phone}
                </span>
                <span className="block text-black/70">
                  {address.street}, {address.city}, {address.governorate}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-black/60">Order summary</h2>
        <ul className="mt-2 divide-y divide-black/10 text-sm">
          {quote.items.map((line) => (
            <li key={line.productId} className="flex justify-between py-2">
              <span>
                {line.name}
                <span className="text-black/50"> × {line.effectiveQuantity}</span>
              </span>
              <span>{line.lineTotal.formatted}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1 text-sm">
          <Row label="Subtotal" value={quote.pricing.itemsSubtotal.formatted} />
          <Row label="Discount" value={quote.pricing.discountTotal.formatted} />
          <Row
            label="Delivery"
            value={
              quote.pricing.shippingFee.amount === 0
                ? 'Not yet calculated'
                : quote.pricing.shippingFee.formatted
            }
          />
          <div className="flex justify-between border-t border-black/10 pt-2 text-base font-black">
            <dt>Total to pay</dt>
            <dd>{quote.pricing.grandTotal.formatted}</dd>
          </div>
        </dl>
        <p className="mt-1 text-xs text-black/50">Cash on delivery. Nothing is charged now.</p>
      </section>

      <form action={formAction} className="mt-8 space-y-3">
        <input type="hidden" name="addressId" value={selectedId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <label className="block text-sm">
          <span className="block text-black/60">Note for the courier (optional)</span>
          <textarea
            name="customerNote"
            rows={2}
            maxLength={500}
            className="mt-1 w-full max-w-lg rounded border border-black/20 px-3 py-2"
          />
        </label>

        {state.error ? (
          <p role="alert" className="text-sm text-red-700">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || !quote.canPlaceOrder}
          className="rounded bg-black px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? 'Placing your order…' : 'Place order'}
        </button>

        {quote.canPlaceOrder ? null : (
          <p className="text-sm text-amber-700">
            Some items in your cart cannot be ordered. Review your cart first.
          </p>
        )}
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-black/70">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
