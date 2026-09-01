import { redirect } from 'next/navigation';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { customerMessage } from '@/lib/api/errors';
import { readSession } from '@/lib/api/session';
import { ApiErrorNotice } from '@/components/shop/ApiErrorNotice';
import { AddressBook } from '@/components/shop/AddressBook';

export const dynamic = 'force-dynamic';

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
 */
export default async function AddressesPage() {
  if ((await readSession()) === null) redirect('/shop/login');

  const result = await tryApi(() => api.listAddresses());

  if (!result.ok) {
    if (result.error.kind === 'unauthenticated') redirect('/shop/login');
    return (
      <ApiErrorNotice
        title="Could not load your addresses"
        message={customerMessage(result.error)}
        requestId={result.error.requestId}
      />
    );
  }

  return <AddressBook addresses={result.data.data} />;
}
