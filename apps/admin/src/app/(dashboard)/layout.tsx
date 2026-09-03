import { AdminSidebar } from "@/components/layout/Sidebar";
import { AdminHeader } from "@/components/layout/AdminHeader";
import { readAdminIdentity } from "@/lib/api/identity";

/**
 * The console shell.
 *
 * ## Where the server-side role check happens
 *
 * `readAdminIdentity()` is `GET /auth/me` against the API. It is the only thing
 * in this application that decides who is operating the console, and it decides
 * it from the SERVER's answer — nothing here decodes a token, and no `role`
 * claim is read in the browser. `proxy.ts` checks only that a session cookie
 * exists, which is a navigation convenience and explicitly not the boundary.
 *
 * This layout is the right place for the real check: it renders once per
 * navigation (a proxy runs on every parallel request a page load makes, and
 * refreshing a ROTATING token from several of those at once is how a valid
 * session gets destroyed), and it already needs the identity to draw the
 * header, so the call costs nothing extra.
 *
 * The API's `RolesGuard` remains the enforcement. Everything decided here is
 * about what to RENDER: a non-staff token gets refused on every `admin/*` route
 * whatever this concludes.
 *
 * ## Why it does not redirect
 *
 * `readAdminIdentity()` returns `null` for three different situations — no
 * session, a session the API rejected, and an API that could not be reached —
 * and only the first two are grounds for sending somebody to the sign-in page.
 * Bouncing an operator to `/login` because the API hiccuped for one request
 * would look exactly like being signed out, and they would sign in again to fix
 * a problem that was never theirs.
 *
 * So the shell renders and the header says the identity is unavailable, naming
 * nobody. The PAGES inside call `requireAdmin()`, which redirects; that is the
 * guard, and it runs for every route under this layout.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await readAdminIdentity();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AdminSidebar identity={identity} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <AdminHeader identity={identity} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1400px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
