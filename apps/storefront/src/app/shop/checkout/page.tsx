import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { ApiErrorNotice } from '@/components/shop/ApiErrorNotice';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';

export const dynamic = 'force-dynamic';

/**
 * Checkout: choose a saved address, read the server's quote, place the order.
 *
 * The client is authoritative for NOTHING here. It sends an `addressId` it
 * already owns and an optional note; the item list comes from the server cart,
 * prices from the catalogue, shipping from the fulfilment policy, identity from
 * the token, and the status from the server. There is no inline shipping
 * address — the field does not exist on the wire, and sending one is a
 * `400 UNKNOWN_FIELD`.
 *
 * The quote is fetched for the SELECTED address, because `shippingFee` is a
 * function of that address's governorate. Placement recomputes everything again
 * inside its own transaction, so nothing shown here is trusted at commit time.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  if ((await readSession()) === null) redirect('/shop/login');

  const { address: selectedParam } = await searchParams;
  const addressResult = await tryApi(() => api.listAddresses());

  if (!addressResult.ok) {
    if (addressResult.error.kind === 'unauthenticated') redirect('/shop/login');

    return (
      <ApiErrorNotice
        title="Could not load checkout"
        message={customerMessage(addressResult.error)}
        requestId={addressResult.error.requestId}
      />
    );
  }

  const addresses = addressResult.data.data;
  const selected =
    addresses.find((a) => a.id === selectedParam) ??
    addresses.find((a) => a.isDefault) ??
    addresses[0];

  if (selected === undefined) {
    return (
      <div>
        <h1 className="text-2xl font-black tracking-tight">Checkout</h1>
        <p className="mt-4 text-sm text-black/60">
          You need a delivery address before you can place an order.
        </p>
        <Link href="/shop/addresses" className="mt-4 inline-block text-sm underline">
          Add an address
        </Link>
      </div>
    );
  }

  const quoteResult = await tryApi(() => api.quote(selected.id));

  if (!quoteResult.ok) {
    return (
      <ApiErrorNotice
        title="Could not price your order"
        message={customerMessage(quoteResult.error)}
        requestId={quoteResult.error.requestId}
      />
    );
  }

  return (
    <CheckoutForm
      addresses={addresses}
      selectedId={selected.id}
      quote={quoteResult.data.data}
      /* One key per rendered attempt. The API is the duplicate-submit guard. */
      idempotencyKey={randomUUID()}
      basePath="/shop/checkout"
    />
  );
}
