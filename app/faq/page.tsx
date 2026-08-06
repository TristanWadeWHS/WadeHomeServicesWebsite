import { SiteShell } from "../components/SiteShell";
import { faqs } from "../lib/siteContent";

export default function FAQ() {
  return (
    <SiteShell>
      <section className="subpage-hero section">
        <p className="eyebrow">FAQ</p>
        <h1>Clear answers without overpromising.</h1>
        <p>
          This draft keeps unverified business details out of the copy until
          Wade Home Services confirms them.
        </p>
      </section>
      <section className="section faq-list">
        {faqs.map((faq) => (
          <article className="faq-item" key={faq.question}>
            <h2>{faq.question}</h2>
            <p>{faq.answer}</p>
          </article>
        ))}
      </section>
    </SiteShell>
  );
}
