import type { Metadata } from "next";
import { Albert_Sans, Urbanist } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { CartDrawer } from "@/components/CartDrawer";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ToastProvider } from "@nest/ui";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
            <Navbar />
            <main className="pb-16 md:pb-0">{children}</main>
            <Footer />
            <MobileBottomNav />
            <CartDrawer />
          </NuqsAdapter>
        </ToastProvider>
      </body>
    </html>
  );
}
