import Link from "next/link";
import { SiteShell } from "./components/SiteShell";
import { reviews, services } from "./lib/siteContent";

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
        <div className="hero__media" aria-label="Wade Home Services work video">
          <iframe
            src="https://www.youtube.com/embed/1D-1jAJewoo?autoplay=1&mute=1&playsinline=1&rel=0&vq=hd1080"
            title="Wade Home Services work video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
          <div className="hero__media-label">Featured work video</div>
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

      <section className="proof section">
        <div className="section-heading section-heading--wide">
          <p className="eyebrow">Trust Proof</p>
          <h2>5-star feedback from homeowners who needed it handled.</h2>
          <p>
            Public Yelp reviews we could verify for Wade Home Services are rated
            5 stars. Google reviews can be added here after we capture the exact
            review text from the live profile.
          </p>
        </div>
        <div className="review-rail" aria-label="Customer review carousel">
          {reviews.map((review) => (
            <article className="review-card" key={`${review.author}-${review.date}`}>
              <div className="stars" aria-label="5 out of 5 stars">
                ★★★★★
              </div>
              <p>{review.quote}</p>
              <div className="review-meta">
                <strong>{review.author}</strong>
                <span>{review.location}</span>
                <span>
                  {review.source} · {review.date}
                </span>
              </div>
            </article>
          ))}
        </div>
        <div className="review-actions">
          <a
            className="button button--dark"
            href="https://www.yelp.com/not_recommended_reviews/wade-home-services-mission-viejo"
            rel="noreferrer"
            target="_blank"
          >
            View Yelp Reviews
          </a>
          <a
            className="button button--ghost"
            href="https://www.google.com/search?q=wade+home+services"
            rel="noreferrer"
            target="_blank"
          >
            View Google Profile
          </a>
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
