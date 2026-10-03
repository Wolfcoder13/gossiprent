# GossipRent

Honest reviews between landlords and renters in Iceland.

- **Renters** review their **landlords** and the **places they rent**.
- **Landlords** review their **renters**.
- Every review has a **1–5 star rating** and a **written review**.
- People are identified by **kennitala**, so namesakes are never mixed up. You can review someone who isn't on GossipRent yet.
- The site is in **Icelandic**, with a switch to **English**.

Built with Next.js 16 (App Router), React 19, Tailwind CSS 4, Drizzle ORM, and Postgres.

## Features

- Sign up with your kennitala as a renter, a landlord, or both. Someone who rents a home and also rents one out gets a separate rating for each role.
- **Review by kennitala**: to review a landlord or renter you enter their kennitala (it's on the lease). If nobody has reviewed that kennitala yet, a profile without an account is created under the name you give. When that person signs up with their kennitala, the profile and its reviews become theirs.
- **Kennitalas are never shown publicly**: not on profiles, in URLs, or in search results. Only you see your own, on your dashboard. Signed-in users can look a kennitala up to find the matching profile.
- **Nobody can remove reviews written about them**: not by closing their account, removing a role, or signing up again. Only a review's author (or the site operator) can delete it.
- Directories of landlords, renters, and properties, with accent-insensitive search ("Kopavogur" finds Kópavogur) and Icelandic A–Ö sorting.
- Icelandic addresses: street and house number, apartment, and a postcode from the official list (e.g. "101 Reykjavík").
- Renters can add the place they rent and link its landlord by kennitala. Landlords can list their properties, claim a listing, or say "Not my property" (after which nobody else can link them to it again); the listing and its reviews always stay on the site.
- A report form for reviews, profiles, properties and taken-over accounts, plus command-line tools for the operator (`npm run admin`).
- A dashboard with reviews about you, reviews you've written, your properties, profile editing, password change, "sign out other devices", and closing your account.
- Works without JavaScript. Supports dark mode and screen readers.

## Run it locally

You need Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. No database setup needed: the app creates a built-in Postgres database (PGlite) in `./.data/pglite` the first time it runs and, in development, fills it with demo data.

Every demo account uses the password `password123`. For example:

| Role                | Email                | Kennitala     |
| ------------------- | -------------------- | ------------- |
| Landlord            | `sigrun@example.com` | `010130-2129` |
| Landlord and renter | `olafur@example.com` | `010130-2209` |
| Renter              | `kari@example.com`   | `010130-2399` |
| Renter              | `asdis@example.com`  | `010130-2479` |

The demo data also has landlord and renter profiles without an account. Demo kennitalas are the official test numbers ("Gervimaður", 010130-xxx9), which the app accepts in development only (see `ALLOW_TEST_KENNITALA` in `.env.example`). To try reviewing someone new, use any valid kennitala of an adult.

To start over, stop the dev server and delete the `.data` folder. **If you ran an earlier version of GossipRent, delete `.data` once now**: the database layout changed. To start with an empty database instead of demo data, set `SEED_DEMO_DATA=false`. (A production build, `npm start`, never adds demo data unless you set `SEED_DEMO_DATA=true`.)

To use your own Postgres locally, copy `.env.example` to `.env.local` and set `DATABASE_URL`.

## Deploy to Vercel

1. Push this repository to GitHub and import it in [Vercel](https://vercel.com/new). The default settings work.
2. In the project's **Storage** tab, choose **Create Database → Neon (Serverless Postgres)** and connect it to the project. This sets `DATABASE_URL` for you.
3. **Redeploy**. Every build runs the database migrations before `next build`, so the tables are created automatically.

If you deploy before adding a database, the site shows setup instructions instead of failing.

**Preview deployments:** builds for pull requests also run migrations. So that a preview can't change your production database, turn on Neon's option to create a database branch for each Preview deployment, or limit `DATABASE_URL` to the Production environment.

**Other Postgres hosts:** set `DATABASE_URL` (or `POSTGRES_URL`) in the project's environment variables. The connection must use a TLS certificate from a public authority, which Neon does. For hosts that use their own certificate authority (such as Supabase or AWS RDS), add `uselibpqcompat=true` to the connection string, or configure their CA certificate.

**If you deployed an earlier version**, its database has the old tables and the new migration can't apply on top of them. There's no real data yet, so empty the database once (for example, delete and recreate it in the Neon dashboard), then redeploy.

New deployments start empty. To add the demo data to a hosted database, run `DATABASE_URL=... npm run db:seed` from your machine. It only seeds an empty database, and every demo account uses the public password above, so don't seed a real production site.

## Scripts

| Command               | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `npm run dev`         | Start the development server.                                       |
| `npm run build`       | Apply database migrations (when `DATABASE_URL` is set), then build. |
| `npm start`           | Serve the production build.                                         |
| `npm run lint`        | Run ESLint.                                                         |
| `npm run typecheck`   | Type-check with TypeScript.                                         |
| `npm test`            | Run the unit tests (Vitest).                                        |
| `npm run test:e2e`    | Run the end-to-end tests (Playwright). Run `npm run build` first.   |
| `npm run db:generate` | Create a new migration after changing `src/db/schema.ts`.           |
| `npm run db:migrate`  | Apply migrations to `DATABASE_URL`.                                 |
| `npm run db:seed`     | Add demo data to an empty database.                                 |
| `npm run admin`       | Operator tools: reports, removing reviews, account resets (below).  |

## Project layout

```
src/
  app/                 Pages and Server Actions (app/actions/*)
  components/          UI components (star rating, review form, cards…)
  db/                  Drizzle schema, connection, demo seed data
  i18n/                Icelandic and English text (messages/is, messages/en), formatting
  lib/                 Auth, validation, data queries, kennitala, postcodes
drizzle/               SQL migrations (generated by drizzle-kit)
scripts/               migrate.mjs, seed.ts and admin.ts
tests/                 Unit (Vitest) and end-to-end (Playwright) tests
```

## How it works

- **Accounts**: passwords are hashed with scrypt. Sessions are random tokens stored in an httpOnly cookie. Only a SHA-256 hash of each token is kept in the database. Email addresses are never shown publicly. Login, sign-up, and password changes are rate limited per account and per IP address (stored in Postgres, so no extra service is needed). On Vercel the IP comes from headers Vercel sets; if you self-host behind your own reverse proxy, set `TRUST_PROXY_HEADERS=true`. Set `AUTH_RATE_LIMIT=off` only for automated tests.
- **People and kennitalas**: everyone GossipRent knows about is one row in `users`, keyed by kennitala, with or without an account (email + password). `src/lib/people.ts` is the only code that looks people up by kennitala. Kennitalas are validated with `is-kennitala` (format and date; there's no check digit any more, so forms show the name or birth date before saving). Database errors from queries that carry a kennitala are replaced with a sanitized error so the number never reaches the logs.
- **Profiles without an account** are created by the first review of a kennitala (or by linking it as a property's landlord). Their name is the one the reviewer typed. Once anyone has reviewed a person, their name can't be changed by them (only by the operator), so a profile can't be renamed to hide its reviews.
- **Closing an account** deletes the login and the reviews that person wrote. Reviews other people wrote *about* them stay, and the profile becomes a profile without an account; signing up again with the same kennitala takes it back. If nothing refers to them, the row is removed completely. In the database, reviews and property links use `ON DELETE RESTRICT`, so no code path can delete reviews about someone by deleting the person.
- **Language**: Icelandic by default; the language switch sets a `lang` cookie (URLs don't change). All text is in `src/i18n/messages/{is,en}`, and a unit test checks both languages have the same keys and placeholders.
- **Who can review whom** is enforced on the server in `src/app/actions/reviews.ts`. If you rent, you can review landlords and properties; if you're a landlord, you can review renters; if you're both, you can do all three. Nobody reviews themselves or a property they manage, and the database allows one review per author per subject and role.
- **Roles**: each person has `is_landlord` and `is_renter` flags, and each review records which role it's about, so ratings never mix. Being reviewed in a role gives you that role, and it can only be removed while nobody has reviewed you in it.
- **Rate limits**: besides login and sign-up, kennitala lookups and checks, new reviews, new profiles and reports are rate limited per account (and per IP where known), so kennitalas can't be guessed by brute force. The IP is only known on Vercel, or behind your own proxy with `TRUST_PROXY_HEADERS=true`. Without it, sign-up and logged-out reports have no limit at all, and since accounts are free, the per-account lookup limits can be multiplied by creating more accounts, so don't self-host without a trusted IP.
- **Database**: with `DATABASE_URL` set, the app uses that Postgres database. Without it, the app uses the embedded database locally, or shows setup instructions on Vercel.

## Moderation

Reports from the site's "Report" links are stored in the `reports` table. Handle them from your machine with the database URL set (needs Node.js 22.15 or newer):

```bash
DATABASE_URL=... npm run admin -- reports                      # list open reports
DATABASE_URL=... npm run admin -- resolve <reportId> "note"
DATABASE_URL=... npm run admin -- remove-review <reviewId>
DATABASE_URL=... npm run admin -- reset-account <userId>       # someone took over another person's kennitala
DATABASE_URL=... npm run admin -- rename-profile <userId> "Correct Name"
DATABASE_URL=... npm run admin -- relink-property <propertyId> <kennitala|none> [name]
```

Resetting an account clears the login but never touches reviews about the person; the real owner can then sign up with their kennitala.

## Before you launch publicly

This is a working first version. Before opening it to the public, consider:

- **Identity**: anyone who knows a kennitala can sign up with it, because identities aren't verified. Kennitalas aren't secret in Iceland (they're on leases and invoices), so the real fix is electronic ID (rafræn skilríki, e.g. through Auðkenni or island.is) at sign-up. Until then, the name lock, the company sign-up block and the report form + `reset-account` limit the damage.
- **Legal (Iceland)**: get advice from an Icelandic lawyer before launch. In particular: whether landlords' reviews of renters fall under the licensing rule for information on creditworthiness (Act 90/2018, art. 15; the review prompts deliberately avoid payment questions), a data protection impact assessment, the privacy page's wording (`/privacy`), how people without an account are informed that they have a profile (GDPR art. 14), a notice-and-takedown process (Act 30/2002), and defamation risk.
- **Abuse protection**: email verification (it needs an email provider), and a review of the built-in rate limits for your traffic. Vercel's firewall can add IP-based limits without code changes.
- **Icelandic text**: the Icelandic copy follows consistent rules (informal "þú", gender-neutral wording), but have a native speaker proofread it, especially the privacy page.
