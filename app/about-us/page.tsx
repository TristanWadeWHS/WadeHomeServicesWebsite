import Image from "next/image";
import { SiteShell } from "../components/SiteShell";

export default function AboutUs() {
  return (
    <SiteShell>
      <section className="subpage-hero section">
        <p className="eyebrow">About Us</p>
        <h1>A local crew built around reliable home-services help.</h1>
        <p>
          Wade Home Services is built for homeowners who want clear
          communication, careful property handling, and dependable help from a
          local team that stays close to the work.
        </p>
      </section>
      <section className="section team-section" aria-labelledby="meet-team-title">
        <div className="section-heading section-heading--wide">
          <p className="eyebrow">Meet the Team</p>
          <h2 id="meet-team-title">Real people behind the work.</h2>
          <p>
            The Wade Home Services experience is meant to feel personal,
            practical, and steady from the first call through the final sweep.
            These are the faces that bring some of that hands-on care and
            personality to the brand.
          </p>
        </div>

        <div className="team-grid">
          <article className="team-card team-card--owner">
            <div className="team-card__image">
              <Image
                src="/team/owner-project-site.jpg"
                alt="Wade Home Services owner at a project site"
                width={1086}
                height={1448}
                sizes="(max-width: 760px) 100vw, 58vw"
                priority
              />
            </div>
            <div className="team-card__body">
              <p className="team-card__role">Owner</p>
              <h3>Wade Home Services</h3>
              <p>
                The company is presented with a hands-on, local point of view:
                responsive communication, organized planning, and respect for
                the home or job site being worked on.
              </p>
            </div>
          </article>

          <article className="team-card">
            <div className="team-card__image">
              <Image
                src="/team/maximus-wade.jpg"
                alt="Maximus Wade, Chief Happiness Officer at Wade Home Services"
                width={565}
                height={800}
                sizes="(max-width: 760px) 100vw, 32vw"
              />
            </div>
            <div className="team-card__body">
              <p className="team-card__role">Maximus Wade</p>
              <h3>Chief Happiness Officer</h3>
              <p>
                A warm reminder that this is a local service brand with real
                personality behind it, while keeping the work itself clear,
                professional, and dependable.
              </p>
            </div>
          </article>
        </div>
      </section>
    </SiteShell>
  );
}
