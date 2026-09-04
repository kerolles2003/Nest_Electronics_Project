/**
 * Where a redirect parameter is allowed to send somebody.
 *
 * ## The rule
 *
 * **Only a path on this site.** A `?redirect=` or a `redirectTo` form field is
 * attacker-controlled — it arrives in a link anybody can send — so an unchecked
 * value is an open redirect: a phishing page reached from a real,
 * correctly-spelled link to this site, arrived at *through a genuine sign-in*,
 * which is the version of it customers have no defence against.
 *
 * A leading `//` is rejected along with everything else that is not a plain
 * path, because `//evil.example` is protocol-relative and a browser reads it as
 * another origin. A leading `/\` is rejected because some browsers normalise
 * the backslash to a forward slash and it becomes the same thing.
 *
 * ## Why it is here and not beside its first caller
 *
 * It was written in `api-auth.actions.ts` and then copied, inline and without
 * the reasoning, into `createAddressAction` — two places that have to agree
 * about what "safe" means, one of which explains itself and one of which does
 * not. That is how the two drift.
 *
 * It cannot simply be exported from the action file: every export of a
 * `'use server'` module must be an async function, so a shared synchronous
 * helper needs a module of its own.
 */

/** `true` only for a path that stays on this origin. */
export function isSafeRedirect(raw: string): boolean {
  if (!raw.startsWith('/')) return false;
  if (raw.startsWith('//')) return false;
  if (raw.startsWith('/\\')) return false;

  return true;
}

/**
 * The same rule with a destination for the rejected case.
 *
 * The fallback is the storefront home, and used to be `/account/orders`.
 * Someone who has just signed in is far more likely to be about to shop than to
 * be auditing their order history, and the account area is one click away in
 * the header — whereas a customer dropped on an orders list has to navigate
 * back out of it to do the thing they came for. Anything unrecognised falls
 * back rather than failing: the sign-in succeeded, and the destination is the
 * least important part of that.
 */
export function safeRedirect(raw: string): string {
  return isSafeRedirect(raw) ? raw : '/';
}
