'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { CartProvider } from '@/components/cart/CartProvider';

/**
 * Who is looking at the page, and the cart they are looking at it with.
 *
 * ## Why the viewer is a prop and not a hook that fetches
 *
 * The session lives in an httpOnly cookie, which no script can read — that is
 * the whole reason it is stored that way, and it is what makes an XSS unable to
 * steal a 30-day refresh token. So the client cannot discover who is signed in;
 * the server resolves it and passes it down, once, as data.
 *
 * The previous implementation was a `useAuth()` hook that opened a Supabase
 * client in the browser, read a session from `localStorage` and then fetched a
 * profile row. Three consequences, all now gone: every page paid a round trip
 * before it could draw the header, the header flickered from "Login" to a name,
 * and the browser held a credential.
 */

export interface Viewer {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';
  /** Up to two letters for the avatar. Derived server-side so it cannot differ per render. */
  readonly initials: string;
}

const ViewerContext = createContext<Viewer | null>(null);

/**
 * The signed-in customer, or `null`.
 *
 * There is no `loading` state and there cannot be one: the answer arrived with
 * the HTML. Anything that used to branch on "still checking" can simply render
 * the truth immediately.
 */
export function useViewer(): Viewer | null {
  return useContext(ViewerContext);
}

export function SiteProviders({
  viewer,
  children,
}: {
  viewer: Viewer | null;
  children: ReactNode;
}) {
  return (
    <ViewerContext.Provider value={viewer}>
      <CartProvider signedIn={viewer !== null}>{children}</CartProvider>
    </ViewerContext.Provider>
  );
}
