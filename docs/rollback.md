# Rollback Procedure

Rollback point before the booking-system feature:

- Branch: `main`
- Commit: `487b00730c591d6ed32e34a0475b040f9f2a1a5f`
- Tag: `pre-booking-system-v1`

## Restore the Previous Website Locally

```bash
git fetch origin --tags
git checkout main
git reset --hard pre-booking-system-v1
npm install
npm run lint
npx tsc --noEmit
npm run build
```

## Restore Production on Vercel

Preferred emergency rollback:

```bash
npx vercel rollback
```

If a specific deployment URL is known:

```bash
npx vercel rollback <previous-production-deployment-url>
```

Alternative source rollback:

```bash
git checkout main
git reset --hard pre-booking-system-v1
git push --force-with-lease origin main
```

Only use the source rollback after confirming that replacing `main` is intended.

## Release Safety Rule

For every major Wade Home Services launch, tag the last known-good production
commit before release and document the previous commit, new commit, release
date, and rollback instructions.

