'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Compass,
  Mail,
  MapPin,
  Phone,
  Plus,
  ShoppingCart,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  createAddressAction,
  deleteAddressAction,
  setDefaultAddressAction,
} from '@/actions/api-shop.actions';
import { emptyActionState } from '@/lib/api/action-state';
import { EGYPTIAN_GOVERNORATES } from '@nest/config/constants';
import type { Address } from '@/lib/api/types';

/** The saved address list plus the create form. */
export function AddressBook({
  addresses,
  redirectTo,
}: {
  addresses: Address[];
  redirectTo?: string;
}) {
  const [showForm, setShowForm] = useState(addresses.length === 0);
  const isCheckoutFlow = redirectTo === '/checkout';

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Checkout return banner */}
      {isCheckoutFlow && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 md:p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <ShoppingCart size={20} />
            </div>
            <div>
              <p className="font-bold text-foreground text-sm">Completing your checkout</p>
              <p className="text-xs text-foreground-muted">
                Add your delivery address below and you will be taken straight back to place your order.
              </p>
            </div>
          </div>
          {addresses.length > 0 && (
            <Link
              href="/checkout"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-primary/20 hover:bg-primary-hover transition-all"
            >
              Back to Checkout
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-border pb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-foreground flex items-center gap-3">
            <MapPin className="text-primary" size={28} />
            Delivery Addresses
          </h2>
          <p className="mt-1 text-[13px] font-medium text-foreground-muted">
            Manage your saved delivery locations and default address.
          </p>
        </div>

        {!showForm && addresses.length < 10 && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-primary/20 hover:bg-primary-hover transition-all cursor-pointer"
          >
            <Plus size={16} />
            Add New Address
          </button>
        )}
      </div>

      {/* Address Form */}
      {showForm ? (
        <AddressForm
          redirectTo={redirectTo}
          isFirstAddress={addresses.length === 0}
          onCancel={addresses.length > 0 ? () => setShowForm(false) : undefined}
        />
      ) : null}

      {/* Address Cards List */}
      {addresses.length === 0 && !showForm ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center space-y-4 bg-surface/30">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-raised flex items-center justify-center text-foreground-muted">
            <MapPin size={26} />
          </div>
          <div>
            <p className="font-bold text-foreground text-base">No saved addresses</p>
            <p className="text-sm text-foreground-muted mt-1 max-w-sm mx-auto">
              Add your delivery address to calculate shipping fees and receive your electronics components.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-primary/20 hover:bg-primary-hover transition-all cursor-pointer"
          >
            <Plus size={16} />
            Add an address
          </button>
        </div>
      ) : addresses.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">
              Saved Locations ({addresses.length}/10)
            </h3>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {addresses.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                redirectTo={redirectTo}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AddressCard({
  address,
  redirectTo,
}: {
  address: Address;
  redirectTo?: string;
}) {
  const [defaultState, makeDefault, settingDefault] = useActionState(
    setDefaultAddressAction,
    emptyActionState,
  );
  const [deleteState, remove, deleting] = useActionState(deleteAddressAction, emptyActionState);
  const error = defaultState.error ?? deleteState.error;

  return (
    <li
      className={`group relative flex flex-col justify-between rounded-2xl border p-5 transition-all ${
        address.isDefault
          ? 'border-primary/40 bg-surface shadow-sm shadow-primary/5'
          : 'border-border bg-surface/60 hover:border-border-strong hover:bg-surface'
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-raised border border-border px-2.5 py-1 text-xs font-bold text-foreground">
              <Tag size={12} className="text-primary" />
              {address.label}
            </span>
            {address.isDefault && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary">
                <Check size={11} />
                Default Address
              </span>
            )}
          </div>
        </div>

        <div className="mt-3.5 space-y-1.5 text-sm">
          <p className="font-bold text-foreground flex items-center gap-2">
            <User size={15} className="text-foreground-muted shrink-0" />
            {address.fullName}
          </p>
          <p className="text-xs text-foreground-muted flex items-center gap-2 font-medium">
            <Phone size={14} className="text-foreground-muted shrink-0" />
            {address.phone}
          </p>
          <p className="text-xs text-foreground-muted flex items-start gap-2 pt-1 leading-relaxed">
            <MapPin size={14} className="text-foreground-muted shrink-0 mt-0.5" />
            <span>
              {address.street}, {address.city}, {address.governorate}
              {address.postalCode ? ` (${address.postalCode})` : ''}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-5 pt-3.5 border-t border-border/60 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {!address.isDefault && (
            <form action={makeDefault}>
              <input type="hidden" name="addressId" value={address.id} />
              <button
                type="submit"
                disabled={settingDefault}
                className="text-xs font-semibold text-foreground-muted hover:text-primary transition-colors disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
              >
                <CheckCircle2 size={13} />
                {settingDefault ? 'Setting…' : 'Set as default'}
              </button>
            </form>
          )}
          <form action={remove}>
            <input type="hidden" name="addressId" value={address.id} />
            <button
              type="submit"
              disabled={deleting}
              className="text-xs font-semibold text-danger/80 hover:text-danger transition-colors disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
            >
              <Trash2 size={13} />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </form>
        </div>

        {redirectTo === '/checkout' && (
          <Link
            href={`/checkout?address=${address.id}`}
            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-primary-hover hover:underline"
          >
            Deliver here
            <ArrowRight size={13} />
          </Link>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AddressForm({
  redirectTo,
  isFirstAddress,
  onCancel,
}: {
  redirectTo?: string;
  isFirstAddress?: boolean;
  onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createAddressAction, emptyActionState);

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-border bg-surface p-6 md:p-8 space-y-6 shadow-xs"
    >
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h3 className="text-base font-bold uppercase tracking-tight text-foreground flex items-center gap-2">
          <Plus className="text-primary" size={18} />
          Add New Delivery Address
        </h3>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium text-foreground-muted hover:text-foreground inline-flex items-center gap-1 cursor-pointer"
          >
            <X size={14} />
            Cancel
          </button>
        )}
      </div>

      {/* Carry redirectTo through the submission */}
      <input type="hidden" name="redirectTo" value={redirectTo ?? ''} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Label"
          name="label"
          placeholder="e.g. Home, Office, Workshop"
          icon={Tag}
          error={state.fieldErrors['label']}
        />
        <Field
          label="Recipient name"
          name="fullName"
          placeholder="Full legal name"
          icon={User}
          error={state.fieldErrors['fullName']}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          placeholder="01012345678"
          icon={Phone}
          error={state.fieldErrors['phone']}
        />
        <GovernorateField error={state.fieldErrors['governorate']} />
        <Field
          label="City"
          name="city"
          placeholder="District or city"
          icon={Building2}
          error={state.fieldErrors['city']}
        />
        <Field
          label="Postal code (optional)"
          name="postalCode"
          placeholder="e.g. 11511"
          required={false}
          icon={Mail}
          error={state.fieldErrors['postalCode']}
        />
      </div>

      <Field
        label="Street, building and apartment"
        name="street"
        placeholder="Street name, building number, floor and apartment"
        icon={MapPin}
        error={state.fieldErrors['street']}
      />

      <label className="flex items-center gap-3 cursor-pointer group select-none py-1">
        <input
          type="checkbox"
          name="isDefault"
          defaultChecked={isFirstAddress}
          className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20 accent-primary cursor-pointer"
        />
        <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
          Set as default delivery address
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger bg-danger/5 border border-danger/10 p-3 rounded-xl">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-primary/20 hover:bg-primary-hover transition-all disabled:opacity-50 cursor-pointer"
        >
          {pending ? (
            'Saving address…'
          ) : redirectTo === '/checkout' ? (
            <>
              Save address & Proceed to Checkout
              <ArrowRight size={15} />
            </>
          ) : (
            <>
              Save address
              <Check size={15} />
            </>
          )}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * A closed list, not a text box.
 *
 * The API refuses any governorate outside the 27 (D-8: the shipping rate table
 * is seeded one row per governorate with no fallback, so an unrecognised value
 * would reach a rate lookup with nothing to find). A free-text input here
 * turned that server rule into a form error the customer had to guess their way
 * out of — "Cairo" works, "cairo" and "Kairo" do not, with nothing on screen
 * saying so.
 *
 * The list comes from `@nest/config` so the dropdown and the legacy account
 * page cannot disagree; `apps/api` keeps its own copy for dependency reasons
 * and a test asserts the two stay identical.
 *
 * This is a convenience, not the guarantee — the server still validates.
 */
function GovernorateField({ error }: { error?: string }) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor="governorate"
        className="block text-[13px] font-bold uppercase tracking-wider text-foreground-muted"
      >
        Governorate
      </label>
      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted group-focus-within:text-primary transition-colors pointer-events-none">
          <Compass size={18} />
        </div>
        <select
          id="governorate"
          name="governorate"
          defaultValue=""
          required
          aria-invalid={error ? true : undefined}
          className="w-full bg-surface border border-border rounded-xl pl-11 pr-4 py-3 text-foreground focus:border-primary focus:ring-4 focus:ring-primary/5 focus:outline-none transition-all text-[14px] font-medium appearance-none cursor-pointer"
        >
          <option value="" disabled>
            Select a governorate
          </option>
          {EGYPTIAN_GOVERNORATES.map((governorate) => (
            <option key={governorate} value={governorate} className="bg-surface text-foreground">
              {governorate}
            </option>
          ))}
        </select>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none text-xs">
          ▼
        </div>
      </div>
      {error ? <span className="text-xs font-medium text-danger">{error}</span> : null}
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  required = true,
  icon: Icon,
  error,
}: {
  label: string;
  name: string;
  type?: 'text' | 'tel';
  placeholder?: string;
  required?: boolean;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={name}
        className="block text-[13px] font-bold uppercase tracking-wider text-foreground-muted"
      >
        {label}
      </label>
      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted group-focus-within:text-primary transition-colors pointer-events-none">
          <Icon size={18} />
        </div>
        <input
          id={name}
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          className="w-full bg-surface border border-border rounded-xl pl-11 pr-4 py-3 text-foreground placeholder:text-foreground-disabled focus:border-primary focus:ring-4 focus:ring-primary/5 focus:outline-none transition-all text-[14px] font-medium"
        />
      </div>
      {error ? <span className="text-xs font-medium text-danger">{error}</span> : null}
    </div>
  );
}
