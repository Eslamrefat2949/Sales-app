# RAVIN Sales App

Mobile-first POS used by every branch during traffic peaks to keep the cashier line short. Sales are
captured on phones (desktop also works), synced to Supabase, and exported every night in the Odoo
import format.

The agreed behaviour is documented in [`docs/business-rules.md`](docs/business-rules.md).

## Repository layout

```
packages/
  domain/      Pure business logic: pricing, offers, cart, catalog search.
               No runtime dependencies, so the same code runs on the phone and in Supabase Edge Functions.
apps/          Web app (PWA) and admin panel (coming next)
docs/          Business rules and design notes
```

## Development

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm test        # run all tests
pnpm typecheck   # type-check all packages
```
