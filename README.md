# GossipRent

Honest reviews between landlords and renters.

- **Renters** review their **landlords** and the **places they rent**.
- **Landlords** review their **renters**.
- Every review has a **1–5 star rating** and a **written review**.

Built with Next.js 16 (App Router), React 19, Tailwind CSS 4, Drizzle ORM, and Postgres.

## Features

- Sign up as a renter, a landlord, or both (email and password). Someone who rents a home and also rents one out gets a separate rating for each role, and can add or remove a role from their dashboard.
- Directories of landlords, renters, and properties, with search and sorting (top rated, most reviewed, newest, A–Z).
- Profile pages with the average rating, a 5→1 star breakdown, and every review.
- One review per person per landlord, renter, or property. Writing again edits your review, and you can delete it.
- Renters can add the place they rent and link it to their landlord. Landlords can list their properties, claim a listing a renter added, or unlink one that isn't theirs.
- A dashboard with reviews about you, reviews you've written, your properties, profile editing, password change, "sign out other devices", and closing your account.
- Works without JavaScript for browsing and search. Supports dark mode and screen readers.

## Run it locally

You need Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. No database setup needed: the app creates a built-in Postgres database (PGlite) in `./.data/pglite` the first time it runs and, in development, fills it with demo data.

Every demo account uses the password `password123`. For example:

| Role                | Email                |
| ------------------- | -------------------- |
| Renter              | `jordan@example.com` |
| Renter              | `lena@example.com`   |
| Landlord            | `maria@example.com`  |
| Landlord and renter | `sam@example.com`    |

To start over, stop the dev server and delete the `.data` folder. To start with an empty database instead of demo data, set `SEED_DEMO_DATA=false`. (A production build, `npm start`, never adds demo data unless you set `SEED_DEMO_DATA=true`.)

To use your own Postgres locally, copy `.env.example` to `.env.local` and set `DATABASE_URL`.

## Deploy to Vercel

1. Push this repository to GitHub and import it in [Vercel](https://vercel.com/new). The default settings work.
2. In the project's **Storage** tab, choose **Create Database → Neon (Serverless Postgres)** and connect it to the project. This sets `DATABASE_URL` for you.
3. **Redeploy**. Every build runs the database migrations before `next build`, so the tables are created automatically.

If you deploy before adding a database, the site shows setup instructions instead of failing.

**Preview deployments:** builds for pull requests also run migrations. So that a preview can't change your production database, turn on Neon's option to create a database branch for each Preview deployment, or limit `DATABASE_URL` to the Production environment.

**Other Postgres hosts:** set `DATABASE_URL` (or `POSTGRES_URL`) in the project's environment variables. The connection must use a TLS certificate from a public authority, which Neon does. For hosts that use their own certificate authority (such as Supabase or AWS RDS), add `uselibpqcompat=true` to the connection string, or configure their CA certificate.

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

## Project layout

```
src/
  app/                 Pages and Server Actions (app/actions/*)
  components/          UI components (star rating, review form, cards…)
  db/                  Drizzle schema, connection, demo seed data
  lib/                 Auth, validation, data queries, formatting
drizzle/               SQL migrations (generated by drizzle-kit)
scripts/               migrate.mjs and seed.ts
tests/                 Unit (Vitest) and end-to-end (Playwright) tests
```

## How it works

- **Accounts**: passwords are hashed with scrypt. Sessions are random tokens stored in an httpOnly cookie. Only a SHA-256 hash of each token is kept in the database. Email addresses are never shown publicly. Login, sign-up, and password changes are rate limited per account and per IP address (stored in Postgres, so no extra service is needed). On Vercel the IP comes from headers Vercel sets; if you self-host behind your own reverse proxy, set `TRUST_PROXY_HEADERS=true`. Set `AUTH_RATE_LIMIT=off` only for automated tests.
- **Closing an account** deletes the login and the reviews that person wrote. Reviews other people wrote *about* them stay on their profile, marked "Account closed", so nobody can erase a bad record by deleting and re-registering. If nobody has reviewed them, the account is removed completely.
- **Who can review whom** is enforced on the server in `src/app/actions/reviews.ts`. If you rent, you can review landlords and properties; if you're a landlord, you can review renters; if you're both, you can do all three. Nobody reviews themselves or a property they manage, and the database allows one review per author per subject and role.
- **Roles**: each account has `is_landlord` and `is_renter` flags, and each review records which role it's about, so ratings never mix. A role can only be removed if nobody has reviewed you in it.
- **Database**: with `DATABASE_URL` set, the app uses that Postgres database. Without it, the app uses the embedded database locally, or shows setup instructions on Vercel.

## Before you launch publicly

This is a working first version. Before opening it to the public, consider:

- **Moderation**: a way to report reviews, and an admin view to remove abusive ones.
- **Abuse protection**: email verification (it needs an email provider), limits on how fast people can post reviews, and a review of the built-in login/sign-up rate limits for your traffic. Vercel's firewall can add IP-based rate limits without code changes.
- **Legal**: reviews about real people carry defamation and privacy risk, and in some places (for example under the US Fair Credit Reporting Act) tenant screening is regulated. Add terms of service and a privacy policy, and get legal advice.
- **Landlords who aren't members yet**: right now only registered landlords and renters can be reviewed. A common next step is letting renters create profiles for landlords who haven't joined, which landlords can claim later.
