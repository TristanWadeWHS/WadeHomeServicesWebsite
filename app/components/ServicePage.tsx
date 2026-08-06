import Link from "next/link";
import { SiteShell } from "./SiteShell";

type Service = {
  title: string;
  kicker: string;
  summary: string;
  details: string[];
};

export function ServicePage({ service }: { service: Service }) {
  return (
    <SiteShell>
      <section className="subpage-hero section">
        <p className="eyebrow">{service.kicker}</p>
        <h1>{service.title}</h1>
        <p>{service.summary}</p>
        <div className="actions">
          <a className="button button--primary" href="/#booking">
            Call
          </a>
          <a className="button button--dark" href="/#booking">
            Book Now
          </a>
        </div>
      </section>
      <section className="section service-detail">
        <div>
          <p className="eyebrow">Scope</p>
          <h2>Typical ways Wade Home Services can help.</h2>
        </div>
        <ul>
          {service.details.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="section final-cta">
        <h2>Need this service?</h2>
        <p>
          Send photos, timing, access notes, and any constraints so the team can
          confirm the right next step.
        </p>
        <Link className="button button--primary" href="/faq">
          Read FAQ
        </Link>
      </section>
    </SiteShell>
  );
}
