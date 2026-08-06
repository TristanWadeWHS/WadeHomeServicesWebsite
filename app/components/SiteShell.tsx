import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { label: "Home", href: "/" },
  { label: "About Us", href: "/about-us" },
  { label: "Junk Removal", href: "/junk-removal" },
  { label: "Demolition", href: "/demolition" },
  { label: "Storage & Relocation", href: "/storage-relocation" },
  { label: "FAQ", href: "/faq" },
];

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Wade Home Services home">
          <Image
            src="/wade-home-services-logo.png"
            alt="Wade Home Services"
            width={160}
            height={160}
            priority
          />
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <a className="button button--ghost" href="/#booking">
            Call
          </a>
          <a className="button button--primary" href="/#booking">
            Book Now
          </a>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div>
          <Image
            src="/wade-home-services-logo.png"
            alt="Wade Home Services"
            width={90}
            height={90}
          />
          <p>
            Local home-services support for cleanouts, light demolition,
            storage, and relocation.
          </p>
        </div>
        <div className="footer-links">
          {navItems.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </div>
      </footer>
    </>
  );
}
