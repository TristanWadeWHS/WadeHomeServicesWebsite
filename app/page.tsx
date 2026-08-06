import Image from "next/image";
import Link from "next/link";
import { SiteShell } from "./components/SiteShell";
import { services } from "./lib/siteContent";

const steps = [
  {
    title: "Send the details",
    text: "Tell us what needs to go, what needs to come down, or what needs to move. Photos are helpful when available.",
  },
  {
    title: "Get a clear plan",
    text: "We confirm access, timing, disposal or storage needs, and the right crew size before work begins.",
  },
  {
    title: "We handle the work",
    text: "The team arrives ready to protect the property, work efficiently, and leave the area swept and usable.",
  },
];

export default function Home() {
  return (
    <SiteShell>
      <section className="hero section">
        <div className="hero__content">
          <p className="eyebrow">Wade Home Services</p>
          <h1>Cleanouts, light demolition, storage, and relocation handled with care.</h1>
          <p className="hero__statement">
            A local home-services crew for projects that need a reliable plan,
            respectful property handling, and a polished finish.
          </p>
          <div className="actions">
            <a className="button button--primary" href="#booking">
              Call Wade Home Services
            </a>
            <a className="button button--light" href="#booking">
              Book Now
            </a>
          </div>
        </div>
        <div className="hero__media" aria-label="Video-ready showcase area">
          <Image
            src="/wade-home-services-logo.png"
            alt="Wade Home Services logo"
            width={1024}
            height={1024}
            priority
          />
          <div className="hero__media-label">Work video placeholder</div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="section-heading">
          <p className="eyebrow">Services</p>
          <h2>Focused help for the work that piles up around a property.</h2>
        </div>
        <div className="service-grid">
          {services.map((service) => (
            <Link className="service-card" href={service.href} key={service.title}>
              <span>{service.kicker}</span>
              <h3>{service.title}</h3>
              <p>{service.summary}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="process section">
        <div className="section-heading">
          <p className="eyebrow">Process</p>
          <h2>Simple from the first message to the final sweep.</h2>
        </div>
        <div className="process-grid">
          {steps.map((step, index) => (
            <article className="process-step" key={step.title}>
              <div className="step-number">0{index + 1}</div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="proof section section--split">
        <div>
          <p className="eyebrow">Trust Proof</p>
          <h2>Built for real local proof as the business grows.</h2>
          <p>
            This draft intentionally uses placeholders for reviews, licenses,
            service radius, and project photos until Wade Home Services confirms
            the exact details.
          </p>
        </div>
        <div className="proof-list" aria-label="Trust proof placeholders">
          <span>Verified customer reviews placeholder</span>
          <span>Before-and-after work gallery placeholder</span>
          <span>Insurance or license details placeholder</span>
          <span>Local service area confirmation placeholder</span>
        </div>
      </section>

      <section className="estimator section">
        <div>
          <p className="eyebrow">Coming Fall 2026</p>
          <h2>AI price estimator</h2>
          <p>
            A clearly labeled future tool for quick project guidance. The live
            site will keep this separate from actual quotes until the estimator
            is ready and approved.
          </p>
        </div>
        <a className="button button--primary" href="#booking">
          Request a Human Estimate
        </a>
      </section>

      <section className="final-cta section" id="booking">
        <h2>Ready to clear the space or move the project forward?</h2>
        <p>
          Add the confirmed phone number, booking form, or scheduling link here.
          Until then, this section keeps the call-to-action visible without
          publishing unverified contact details.
        </p>
        <div className="actions actions--center">
          <a className="button button--primary" href="#booking">
            Call
          </a>
          <a className="button button--dark" href="#booking">
            Book Now
          </a>
        </div>
      </section>
    </SiteShell>
  );
}
