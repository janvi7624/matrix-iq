import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BRAND } from "@/lib/branding";
import AppProviders from "@/components/ui/AppProviders";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// preload:false because this face is referenced by exactly one rule in the
// whole product — the `@username` line in the employee directory
// (components/employeeDirectory.module.css .personSub) — yet declaring it on
// <html> made Next preload its 22.6KB woff2 on EVERY page, including the
// login screen, which renders no monospace character at all. With preloading
// off the variable still resolves and the font is still fetched on the one
// screen that actually paints with it; every other page stops paying for it.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.appName} — ${BRAND.tagline}`,
    template: `%s — ${BRAND.appName}`,
  },
  description: BRAND.description,
  applicationName: BRAND.appName,
  icons: { icon: BRAND.favicon },
  openGraph: {
    title: BRAND.appName,
    description: BRAND.description,
    siteName: BRAND.appName,
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Deliberately not setting maximumScale/userScalable — locking pinch-zoom
  // fails WCAG 1.4.4 and isn't needed to fix any layout issue here.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
