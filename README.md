# Wade Home Services Website

First working draft for a fresh Wade Home Services website rebuild independent
of Wix.

## Current Draft

- Responsive home page with video-ready hero, services overview, process,
  review carousel, Fall 2026 AI estimator teaser, and booking CTA.
- Focused routes for About Us, Junk Removal, Demolition, Storage & Relocation,
  FAQ, and Book Now intake.
- Header uses the exact supplied Wade Home Services logo from the user-provided
  image asset.
- Copy avoids invented reviews, licenses, prices, service areas, contact
  details, and unverified marketing claims.
- Booking system Phase 1/2 is being developed on a feature branch and must be
  reviewed in preview before production release.

## Booking System

See:

- `docs/booking-system.md`
- `docs/rollback.md`
- `.env.example`

The booking flow requires Google Sheets, Google Calendar, bot-protection, and
private photo-storage environment variables before real customer submissions can
be accepted.

## Commands

```bash
npm install
npm run dev
npm run build
npm test
```

## Notes Before Launch

Replace placeholders after Wade Home Services confirms:

- phone number and booking destination
- service area
- customer reviews and project photos
- license, insurance, or credential language
- real work video or hero media

No production deployment, DNS change, or Wix change has been made from this
draft.
