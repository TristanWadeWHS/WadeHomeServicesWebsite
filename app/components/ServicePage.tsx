import Link from "next/link";
import { BeforeAfterCarousel } from "./BeforeAfterCarousel";
import { SiteShell } from "./SiteShell";

type BeforeAfterImage = {
  src: string;
  alt: string;
};

type BeforeAfterPair = {
  title: string;
  before: BeforeAfterImage;
  after: BeforeAfterImage;
};

type HeroVideo = {
  src: string;
  title: string;
  label: string;
};

type Service = {
  title: string;
  kicker: string;
  summary: string;
  details: string[];
  heroVideo?: HeroVideo;
  beforeAfterPairs?: BeforeAfterPair[];
};

export function ServicePage({ service }: { service: Service }) {
  return (
    <SiteShell>
      <section
        className={`subpage-hero section${service.heroVideo ? " subpage-hero--media" : ""}`}
      >
        <div className="subpage-hero__content">
          <p className="eyebrow">{service.kicker}</p>
          <h1>{service.title}</h1>
          <p>{service.summary}</p>
          <div className="actions">
            <a className="button button--primary" href="tel:+19494245605">
              Call 949-424-5605
            </a>
            <Link className="button button--dark" href="/book">
              Book Now
            </Link>
          </div>
        </div>
        {service.heroVideo ? (
          <div className="service-hero-video" aria-label={service.heroVideo.label}>
            <iframe
              src={service.heroVideo.src}
              title={service.heroVideo.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
            <div className="hero__media-label">{service.heroVideo.label}</div>
          </div>
        ) : null}
      </section>
      {service.beforeAfterPairs ? (
        <section className="section project-photos" aria-labelledby="project-photos-title">
          <div className="section-heading section-heading--wide">
            <p className="eyebrow">Project Photos</p>
            <h2 id="project-photos-title">Before and after cleanout work.</h2>
            <p>
              Verified pairs from the same Wade Home Services job sites, shown
              as clear project progress instead of mixed, unrelated photos.
            </p>
          </div>
          <BeforeAfterCarousel pairs={service.beforeAfterPairs} />
        </section>
      ) : null}
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
