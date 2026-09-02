import { redirect } from 'next/navigation';
import { ROUTES } from '@nest/config/constants';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { AddressBook } from '@/components/shop/AddressBook';

/**
 * The address book.
 *
 * Every invariant here belongs to the API and is deliberately NOT re-enforced
 * on this page:
 *
 *  - **Ownership** is a query filter server-side. A foreign id answers 404,
 *    identically to one that does not exist, so there is nothing for the client
 *    to check and no way for it to probe.
 *  - **"At most one default"** is settled by a single atomic update. This page
 *    never toggles a flag locally and never assumes which address won.
 *  - **The 10-address cap** is enforced in the create filter and surfaces as
 *    `422 ADDRESS_LIMIT_REACHED`; there is no client-side count guard.
 *
 * Set-default and delete return the WHOLE book because either can move the
 * default to an address the caller did not name, so this page re-reads the
 * server's list rather than merging the one entry it touched.
 *
 * The 442-line Supabase version it replaces did the opposite of all three: it
 * queried `addresses` from the browser, toggled `is_default` itself with a
 * read-then-write, and counted rows client-side.
 */
export const dynamic = 'force-dynamic';

export default async function AddressesPage() {
  if ((await readSession()) === null) {
    redirect(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.account.addresses)}`);
  }

  const result = await tryApi(() => api.listAddresses());

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') {
      redirect(`${ROUTES.login}?redirect=${encodeURIComponent(ROUTES.account.addresses)}`);
    }

    return (
      <div className="min-h-[300px] space-y-3">
        <h2 className="text-2xl font-black uppercase tracking-tight">
          Could not load your addresses
        </h2>
        <p role="alert" className="font-medium text-danger">
          {customerMessage(result.error)}
        </p>
      </div>
    );
  }

  return <AddressBook addresses={result.data.data} />;
}
