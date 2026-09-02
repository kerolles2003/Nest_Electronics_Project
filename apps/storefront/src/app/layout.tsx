import type { Metadata } from "next";
import { Albert_Sans, Urbanist } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { CartDrawer } from "@/components/CartDrawer";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ToastProvider } from "@nest/ui";
import { SiteProviders } from "@/components/providers/SiteProviders";
import { GuestCartMerge } from "@/components/cart/GuestCartMerge";
import { readViewer } from "@/lib/api/viewer";
import "./globals.css";

const albertSans = Albert_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const urbanist = Urbanist({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nest Electronics — Components for Makers | Cairo, Egypt",
  description: "Arduino, ESP32, sensors, modules — Egypt's electronics store for engineers and makers. Same-day dispatch from Cairo.",
};

/**
 * The shell, and the one place the site learns who is looking at it.
 *
 * `readViewer()` resolves the session server-side — the cookie is httpOnly, so
 * no client component could — and hands the answer down as data. Everything
 * below reads it from context: no page fetches its own copy, and the header
 * never flickers from "Login" to a name.
 *
 * It is `async` for that reason, which makes every route dynamic. That is
 * already true: the header shows a per-customer cart and a per-customer name,
 * so a cached shell would be a shell showing somebody else's.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const viewer = await readViewer();

  return (
    <html
      lang="en"
      data-storefront-theme="woodmart"
      data-scroll-behavior="smooth"
      className={`${albertSans.variable} ${urbanist.variable} font-sans antialiased`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning className="min-h-screen bg-background text-foreground font-sans transition-colors duration-200">
        <ToastProvider>
          <NuqsAdapter>
            <SiteProviders viewer={viewer}>
              <Navbar />
              <main className="pb-16 md:pb-0">{children}</main>
              <Footer />
              <MobileBottomNav />
              <CartDrawer />
              {/*
                * The guest-cart merge, mounted for a signed-in customer on
                * every page rather than on one route.
                *
                * Sign-in can finish anywhere — the login form, a reset link, a
                * session restored from a cookie on a product page — and the
                * basket has to move whichever door was used. Mounting it here
                * means the merge is a property of BEING signed in, not of
                * having visited a particular page. An empty basket with no
                * pending plan costs no request.
                */}
              {viewer === null ? null : <GuestCartMerge />}
            </SiteProviders>
          </NuqsAdapter>
        </ToastProvider>
      </body>
    </html>
  );
}
