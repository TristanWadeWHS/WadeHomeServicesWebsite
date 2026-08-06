import { SiteShell } from "../components/SiteShell";

export default function AboutUs() {
  return (
    <SiteShell>
      <section className="subpage-hero section">
        <p className="eyebrow">About Us</p>
        <h1>A local crew built around reliable home-services help.</h1>
        <p>
          Wade Home Services is presented here as a premium, practical, and
          credible property support company. The draft keeps the copy grounded
          until the team confirms founder details, service area, credentials,
          photos, and customer proof.
        </p>
      </section>
      <section className="section section--split">
        <div>
          <h2>What this brand should feel like</h2>
          <p>
            Calm, direct, and capable. The site avoids exaggerated claims and
            uses clear language around cleanouts, light demolition, storage, and
            relocation.
          </p>
        </div>
        <div className="proof-list">
          <span>Founder story placeholder</span>
          <span>Team photo placeholder</span>
          <span>Service-area map placeholder</span>
          <span>Credentials placeholder</span>
        </div>
      </section>
    </SiteShell>
  );
}
