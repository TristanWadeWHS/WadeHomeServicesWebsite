import Image from "next/image";
import Link from "next/link";
import { SiteShell } from "./SiteShell";

type ServicePhoto = {
  src: string;
  alt: string;
  label: string;
};

type Service = {
  title: string;
  kicker: string;
  summary: string;
  details: string[];
  photos?: ServicePhoto[];
};

export function ServicePage({ service }: { service: Service }) {
  return (
    <SiteShell>
      <section className="subpage-hero section">
        <p className="eyebrow">{service.kicker}</p>
        <h1>{service.title}</h1>
        <p>{service.summary}</p>
        <div className="actions">
          <a className="button button--primary" href="tel:+19494245605">
            Call 949-424-5605
          </a>
          <Link className="button button--dark" href="/#booking">
            Book Now
          </Link>
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
      {service.photos ? (
        <section className="section project-photos" aria-labelledby="project-photos-title">
          <div className="section-heading section-heading--wide">
            <p className="eyebrow">Project Photos</p>
            <h2 id="project-photos-title">Real Wade Home Services cleanout work.</h2>
            <p>
              Selected from the Wade Home Services shared job album and cropped
              for a clean, professional service-page presentation.
            </p>
          </div>
          <div className="photo-grid">
            {service.photos.map((photo) => (
              <figure className="photo-card" key={photo.src}>
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  width={900}
                  height={1200}
                  sizes="(max-width: 760px) 100vw, 33vw"
                />
                <figcaption>{photo.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
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
