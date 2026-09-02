'use client';

import { useActionState } from 'react';
import { BadgeCheck, Mail, Phone, Save, User } from 'lucide-react';
import { updateProfileAction } from '@/actions/api-account.actions';
import { emptyActionState } from '@/lib/api/action-state';
import { AuthError, AuthField, AuthNotice, AuthSubmit } from '@/components/auth/AuthField';

/**
 * Name and phone. Nothing else is editable, because nothing else is editable.
 *
 * ## Clearing the phone
 *
 * The field always submits, so an empty box is the customer removing their
 * number and the action sends `null` — which is how the API spells "remove
 * it". Omitting the key instead means "leave it alone", and would make the
 * number unclearable through the only UI that exists for it.
 *
 * ## The phone format is not validated here
 *
 * The API owns it (Egyptian mobile numbers) and reports it against the `phone`
 * field. A local regex would drift from the server's and start rejecting
 * numbers the server accepts.
 */
export function ProfileForm({
  fullName,
  phone,
  email,
  emailVerified,
}: {
  fullName: string;
  phone: string | null;
  email: string;
  emailVerified: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, emptyActionState);

  return (
    <form action={formAction} className="max-w-lg space-y-5">
      <AuthError message={state.error} />
      <AuthNotice message={state.message} />

      <AuthField
        label="Full Name"
        name="fullName"
        icon={User}
        autoComplete="name"
        defaultValue={fullName}
        error={state.fieldErrors['fullName']}
      />

      <AuthField
        label="Phone"
        name="phone"
        type="tel"
        icon={Phone}
        autoComplete="tel"
        required={false}
        defaultValue={phone ?? ''}
        placeholder="01012345678"
        error={state.fieldErrors['phone']}
      />

      {/*
        * Read-only, and shown rather than hidden.
        *
        * Changing an address is a re-verification flow, not a field edit — the
        * API has no route for it — so this is presented as a fact about the
        * account instead of an input that would fail.
        */}
      <div className="space-y-1.5">
        <span className="ml-1 block text-[13px] font-bold uppercase tracking-wider text-foreground-muted">
          Email Address
        </span>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/60 px-4 py-3.5">
          <Mail size={18} className="text-foreground-muted" />
          <span className="text-[15px] font-medium text-foreground">{email}</span>
          {emailVerified && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-primary">
              <BadgeCheck size={14} />
              Verified
            </span>
          )}
        </div>
        <p className="px-1 text-xs text-foreground-muted">
          Contact us to change the address on your account — it has to be verified again.
        </p>
      </div>

      <AuthSubmit pending={pending} idle="Save Changes" busy="Saving…" icon={Save} />
    </form>
  );
}
