import { BookingFlow } from "../components/booking/BookingFlow";
import { SiteShell } from "../components/SiteShell";

export default function BookPage() {
  return (
    <SiteShell>
      <section className="subpage-hero subpage-hero--compact section">
        <p className="eyebrow">Request Service</p>
        <h1 className="hero-heading">Tell us what you need handled.</h1>
        <p>
          Choose your services, share the project details, upload photos, and
          request a preferred available time. Wade Home Services will review and
          confirm before anything is booked.
        </p>
      </section>
      <BookingFlow />
    </SiteShell>
  );
}
