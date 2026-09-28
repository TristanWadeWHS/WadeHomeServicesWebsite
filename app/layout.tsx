import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wade Home Services",
  description:
    "Local junk removal, light demolition, storage, and relocation support from Wade Home Services.",
  icons: {
    icon: "/wade-home-services-logo.png",
    shortcut: "/wade-home-services-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=AW-18479932144"
        strategy="afterInteractive"
      />
      <Script id="google-ads-tag" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'AW-18479932144');`}
      </Script>
    </html>
  );
}
