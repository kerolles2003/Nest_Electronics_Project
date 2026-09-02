'use client';

import { useState, type ComponentType, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * One labelled input, in the house style, with the server's error under it.
 *
 * ## The errors are the API's, and only the API's
 *
 * `error` comes from `error.details[]`, which names the field it is about. This
 * component never validates anything. The password policy, the email format and
 * the phone format are enforced by the server, and a second copy here would
 * drift from it and start rejecting input the server would accept — which is
 * exactly what the old forms did with their local zod schemas.
 *
 * `aria-invalid` and `aria-describedby` are wired so a screen reader reaches
 * the message; the old forms rendered a single error paragraph at the top of
 * the form, unlinked from any input.
 */
export function AuthField({
  label,
  name,
  type = 'text',
  icon: Icon,
  autoComplete,
  required = true,
  defaultValue,
  placeholder,
  error,
  hint,
}: {
  label: string;
  name: string;
  type?: 'text' | 'email' | 'password' | 'tel';
  icon: ComponentType<{ size?: number | string; className?: string }>;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  error?: string;
  /** An extra control on the label row — the "Forgot?" link, for instance. */
  hint?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const errorId = `${name}-error`;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center px-1">
        <label
          htmlFor={name}
          className="text-[13px] font-bold uppercase tracking-wider text-foreground-muted"
        >
          {label}
        </label>
        {hint}
      </div>

      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted group-focus-within:text-primary transition-colors">
          <Icon size={18} />
        </div>

        <input
          id={name}
          name={name}
          type={isPassword && revealed ? 'text' : type}
          defaultValue={defaultValue}
          autoComplete={autoComplete}
          required={required}
          placeholder={placeholder}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : errorId}
          className="w-full bg-surface border border-border rounded-xl px-11 py-3.5 text-foreground placeholder:text-foreground-disabled focus:border-primary focus:ring-4 focus:ring-primary/5 focus:outline-none transition-all text-[15px] font-medium"
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => {
              setRevealed(!revealed);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
            aria-label={revealed ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>

      {error !== undefined && (
        <p id={errorId} className="px-1 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The form-level message: what went wrong that no single field owns. */
export function AuthError({ message }: { message: string | null }) {
  if (message === null) return null;

  return (
    <div
      role="alert"
      className="rounded-xl bg-danger/5 border border-danger/10 p-4 text-sm text-danger animate-in fade-in slide-in-from-top-1 duration-300"
    >
      <p className="font-semibold">{message}</p>
    </div>
  );
}

/** The form-level success message, for actions that report rather than navigate. */
export function AuthNotice({ message }: { message: string | null | undefined }) {
  if (message === null || message === undefined) return null;

  return (
    <div
      role="status"
      className="rounded-xl bg-primary/5 border border-primary/10 p-4 text-sm text-foreground animate-in fade-in slide-in-from-top-1 duration-300"
    >
      <p className="font-medium">{message}</p>
    </div>
  );
}

/** The submit button, with the pending state every one of these forms needs. */
export function AuthSubmit({
  pending,
  idle,
  busy,
  icon: Icon,
}: {
  pending: boolean;
  idle: string;
  busy: string;
  icon?: ComponentType<{ size?: number | string }>;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full bg-primary text-white py-4 rounded-xl font-bold uppercase tracking-widest text-[13px] hover:bg-primary-hover hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-3"
    >
      {pending ? (
        busy
      ) : (
        <>
          {idle}
          {Icon === undefined ? null : <Icon size={18} />}
        </>
      )}
    </button>
  );
}
