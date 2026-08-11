import Image from "next/image";
import { SiteShell } from "../components/SiteShell";

export default function AboutUs() {
  return (
    <SiteShell>
      <section className="subpage-hero subpage-hero--compact section">
        <p className="eyebrow">About Us</p>
        <h1 className="hero-heading">
          A local crew built around reliable home-services help.
        </h1>
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
            A quick introduction to the people behind the Wade Home Services
            name.
          </p>
        </div>

        <div className="team-banner-grid">
          <article className="team-banner">
            <div className="team-banner__image">
              <Image
                src="/team/owner-project-site.jpg"
                alt="Wade Home Services owner at a project site"
                width={1086}
                height={1448}
                sizes="96px"
                priority
              />
            </div>
            <div className="team-banner__body">
              <p>Owner</p>
              <h3>Tristan Wade</h3>
            </div>
          </article>

          <article className="team-banner">
            <div className="team-banner__image">
              <Image
                src="/team/maximus-wade.jpg"
                alt="Maximus Wade, Chief Happiness Officer at Wade Home Services"
                width={565}
                height={800}
                sizes="96px"
              />
            </div>
            <div className="team-banner__body">
              <p>Chief Happiness Officer</p>
              <h3>Maximus Wade</h3>
            </div>
          </article>
        </div>
      </section>
    </SiteShell>
  );
}
