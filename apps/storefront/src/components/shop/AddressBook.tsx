'use client';

import { useActionState, useState } from 'react';
import {
  createAddressAction,
  deleteAddressAction,
  setDefaultAddressAction,
} from '@/actions/api-shop.actions';
import { emptyActionState } from '@/lib/api/action-state';
import type { Address } from '@/lib/api/types';

/** The saved address list plus the create form. */
export function AddressBook({ addresses }: { addresses: Address[] }) {
  const [showForm, setShowForm] = useState(addresses.length === 0);

  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight">Delivery addresses</h1>

      {addresses.length === 0 ? (
        <p className="mt-4 text-sm text-black/60">
          You have no saved addresses. Add one to check out.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {addresses.map((address) => (
            <AddressCard key={address.id} address={address} />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setShowForm((v) => !v)}
        className="mt-6 text-sm underline"
      >
        {showForm ? 'Cancel' : 'Add an address'}
      </button>

      {showForm ? <AddressForm /> : null}
    </div>
  );
}

function AddressCard({ address }: { address: Address }) {
  const [defaultState, makeDefault, settingDefault] = useActionState(
    setDefaultAddressAction,
    emptyActionState,
  );
  const [deleteState, remove, deleting] = useActionState(deleteAddressAction, emptyActionState);
  const error = defaultState.error ?? deleteState.error;

  return (
    <li className="rounded-lg border border-black/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm">
          <p className="font-semibold">
            {address.label}
            {address.isDefault ? (
              <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                Default
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-black/70">{address.fullName} · {address.phone}</p>
          <p className="text-black/70">
            {address.street}, {address.city}, {address.governorate}
            {address.postalCode ? ` ${address.postalCode}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {address.isDefault ? null : (
            <form action={makeDefault}>
              <input type="hidden" name="addressId" value={address.id} />
              <button type="submit" disabled={settingDefault} className="underline disabled:opacity-50">
                {settingDefault ? 'Setting…' : 'Make default'}
              </button>
            </form>
          )}
          <form action={remove}>
            <input type="hidden" name="addressId" value={address.id} />
            <button type="submit" disabled={deleting} className="text-red-700 underline disabled:opacity-50">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </form>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AddressForm() {
  const [state, formAction, pending] = useActionState(createAddressAction, emptyActionState);

  return (
    <form action={formAction} className="mt-4 max-w-lg space-y-3 rounded-lg border border-black/10 p-4">
      <Field label="Label" name="label" error={state.fieldErrors['label']} />
      <Field label="Recipient name" name="fullName" error={state.fieldErrors['fullName']} />
      <Field label="Phone" name="phone" error={state.fieldErrors['phone']} />
      <Field label="Street, building and apartment" name="street" error={state.fieldErrors['street']} />
      <Field label="City" name="city" error={state.fieldErrors['city']} />
      <Field label="Governorate" name="governorate" error={state.fieldErrors['governorate']} />
      <Field
        label="Postal code (optional)"
        name="postalCode"
        error={state.fieldErrors['postalCode']}
      />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isDefault" />
        Make this my default address
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-black px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save address'}
      </button>
    </form>
  );
}

function Field({ label, name, error }: { label: string; name: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="block text-black/60">{label}</span>
      <input
        name={name}
        aria-invalid={error ? true : undefined}
        className="mt-1 w-full rounded border border-black/20 px-3 py-2"
      />
      {error ? <span className="mt-1 block text-xs text-red-700">{error}</span> : null}
    </label>
  );
}
