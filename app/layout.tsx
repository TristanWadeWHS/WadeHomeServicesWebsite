import type { Metadata } from "next";
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
    </html>
  );
}
