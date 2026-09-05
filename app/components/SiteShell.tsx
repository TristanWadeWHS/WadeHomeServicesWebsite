"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileNavOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setMobileNavOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [mobileNavOpen]);

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  return (
    <>
      <header className="site-header" ref={headerRef}>
        <Link className="brand" href="/" aria-label="Wade Home Services home" onClick={closeMobileNav}>
          <span className="brand__mark">
            <Image
              src="/wade-home-services-logo.png"
              alt=""
              width={300}
              height={300}
              priority
            />
          </span>
          <span className="brand__copy">
            <span className="brand__name">Wade Home Services</span>
            <span className="brand__tagline">Southern California&apos;s Trusted Specialist</span>
          </span>
        </Link>
        <button
          aria-controls="mobile-navigation"
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          className="mobile-menu-toggle"
          onClick={() => setMobileNavOpen((open) => !open)}
          type="button"
        >
          <span />
          <span />
          <span />
        </button>
        <nav className="site-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <a className="button button--ghost" href="tel:+19494245605">
            Call Now!
          </a>
          <Link className="button button--primary" href="/book">
            Book Now
          </Link>
        </div>
        <div
          className="mobile-nav-panel"
          data-open={mobileNavOpen}
          id="mobile-navigation"
        >
          <nav aria-label="Mobile primary navigation">
            {navItems.map((item) => (
              <Link href={item.href} key={item.href} onClick={closeMobileNav}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mobile-nav-actions">
            <a className="button button--ghost" href="tel:+19494245605" onClick={closeMobileNav}>
              Call Now!
            </a>
            <Link className="button button--primary" href="/book" onClick={closeMobileNav}>
              Book Now
            </Link>
          </div>
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
