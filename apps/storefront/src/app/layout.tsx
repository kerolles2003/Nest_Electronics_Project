import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ToastProvider } from "@nest/ui";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { MobileBottomNav } from "@/components/MobileBottomNav";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Nest Electronics | Egypt's #1 Electronics Store for Engineers & Makers",
  description:
    "Egypt's premier electronics & embedded systems store for engineers, students, and makers. Arduino, ESP32, sensors, motors, displays and 500+ more components. Delivered across Egypt.",
  openGraph: {
    title: "Nest Electronics",
    description: "Egypt's #1 electronics store for engineers and makers.",
    type: "website",
    locale: "en_EG",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-foreground font-sans">
        <NuqsAdapter>
          <ToastProvider>
            <Navbar />
            <main className="flex-1 pb-14 md:pb-0">{children}</main>
            <Footer />
            <MobileBottomNav />
          </ToastProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
