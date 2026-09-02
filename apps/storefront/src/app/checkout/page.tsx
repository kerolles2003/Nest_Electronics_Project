import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MapPin, ShoppingBag } from 'lucide-react';
import { ROUTES } from '@nest/config/constants';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';

/**
 * Checkout: choose a saved address, read the server's quote, place the order.
 *
 * ## The client is authoritative for NOTHING
 *
 * It sends an `addressId` it already owns and an optional note. The item list
 * comes from the server cart, prices from the catalogue, delivery from the
 * fulfilment policy, identity from the token, and the status from the server.
 * There is no inline shipping address — the field does not exist on the wire,
 * and sending one is a `400 UNKNOWN_FIELD`.
 *
 * ## The quote is per ADDRESS
 *
 * `shippingFee` is a function of the selected address's governorate (D-8: Cairo
 * and Giza one rate, the other 25 governorates another), so the quote is
 * fetched for the chosen address and re-fetched when the choice changes.
 * Placement recomputes everything again inside its own transaction, so nothing
 * shown here is trusted at commit time.
 *
 * ## What this replaces
 *
 * A client-side three-step wizard that summed a browser cart store, applied a
 * hardcoded shipping rule of its own, and posted the total to a server action.
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  if ((await readSession()) === null) {
    redirect(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.checkout)}`);
  }

  const { address: selectedParam } = await searchParams;

  const [addressResult, cartResult] = await Promise.all([
    tryApi(() => api.listAddresses()),
    tryApi(() => api.getCart()),
  ]);

  if (!addressResult.ok) {
    if (addressResult.error.kind === 'unauthenticated') {
      redirect(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.checkout)}`);
    }

    return (
      <Shell>
        <p role="alert" className="text-center font-medium text-danger">
          {customerMessage(addressResult.error)}
        </p>
      </Shell>
    );
  }

  /*
   * An empty cart is answered BEFORE the address prompt.
   *
   * Someone with no cart and no address should be told to go shopping, not to
   * add an address for an order they have nothing to put in.
   */
  if (cartResult.ok && cartResult.data.data.items.length === 0) {
    return (
      <Shell>
        <Prompt
          icon={ShoppingBag}
          heading="Your cart is empty"
          body="Add some products to your cart before checking out."
          cta={{ href: ROUTES.products, label: 'Continue Shopping' }}
        />
      </Shell>
    );
  }

  const addresses = addressResult.data.data;
  const selected =
    addresses.find((a) => a.id === selectedParam) ??
    addresses.find((a) => a.isDefault) ??
    addresses[0];

  if (selected === undefined) {
    return (
      <Shell>
        <Prompt
          icon={MapPin}
          heading="Add a delivery address"
          body="We need somewhere to send your order before you can place it."
          cta={{ href: ROUTES.account.addresses, label: 'Add an address' }}
        />
      </Shell>
    );
  }

  const quoteResult = await tryApi(() => api.quote(selected.id));

  if (!quoteResult.ok) {
    return (
      <Shell>
        <p role="alert" className="text-center font-medium text-danger">
          {customerMessage(quoteResult.error)}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <CheckoutForm
        addresses={addresses}
        selectedId={selected.id}
        quote={quoteResult.data.data}
        idempotencyKey={randomUUID()}
        basePath={ROUTES.checkout}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-low min-h-screen pb-16">
      <div className="bg-card border-b border-border/50 pt-10 pb-10 mb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-black text-foreground mb-2">Checkout</h1>
        <p className="text-foreground-muted">Complete your order securely</p>
      </div>
      <div className="container mx-auto px-4 max-w-6xl">{children}</div>
    </div>
  );
}

function Prompt({
  icon: Icon,
  heading,
  body,
  cta,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  heading: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="mx-auto max-w-lg rounded-3xl border border-border/50 bg-card p-12 text-center shadow-sm">
      <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-surface">
        <Icon className="h-12 w-12 text-primary/40" strokeWidth={1.5} />
      </div>
      <h2 className="mb-3 text-3xl font-bold text-foreground">{heading}</h2>
      <p className="mb-8 text-lg text-foreground-muted">{body}</p>
      <Link
        href={cta.href}
        className="block w-full rounded-2xl bg-primary py-4 text-base font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-primary-hover"
      >
        {cta.label}
      </Link>
    </div>
  );
}
