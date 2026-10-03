# GossipRent for Iceland — design spec

The contract the Iceland change was built to. Notes added after implementation are marked *Implemented:*.

This is the contract every implementer follows. Repo: Next.js 16.3 App Router, React 19.2,
Drizzle 0.45 + Postgres/PGlite, zod 4, Tailwind v4, Vitest (tests/unit), Playwright (tests/e2e).
Read AGENTS.md: this Next.js has breaking changes; its docs are in node_modules/next/dist/docs/.
No one uses the site yet: the schema is rewritten as one fresh drizzle/0000 migration.

## 0. Rules for everyone

- Edit only the files you own (see the wave plan you were given). If you need a change in a file you
  don't own, don't make it: list it under "requests" in your report.
- Type-check with `npx tsc --noEmit --incremental false -p .` and look at errors in your files.
  Don't run `next build` or `next typegen` (the lead does). Lint your files with `npx eslint <paths>`.
- Keep existing English UI text verbatim when its meaning is unchanged (≈1000 e2e locators use it).
- A kennitala never appears in: public HTML or RSC payloads of pages about other people, page metadata,
  URLs (no GET params), rate-limit keys, log lines, thrown error messages, or client props other than the
  author's own form echo. The account owner sees their own on the dashboard only.
- Server code that sends a kennitala (or a password hash) to the database catches failures and rethrows
  `sanitizeDbError(e)` (src/db/index.ts), which keeps only the Postgres code and constraint name.

## 1. Language

- Locales `is` (default) and `en`; chosen per visitor by an httpOnly `lang` cookie (1 year, SameSite=Lax,
  secure in production). No cookie → Icelandic. URLs never change. Only Icelandic gets indexed (fine).
- Switch: client component `LanguageSwitch` (src/components/language-switch.tsx) renders
  `<form action={setLocale}>` with hidden `next` = pathname + search (usePathname/useSearchParams) and one
  submit button `name="locale" value={other} lang={other}` labelled with that language's own name
  ("English" / "Íslenska"). `setLocale` (src/app/actions/locale.ts) validates, sets the cookie and calls
  `redirect(safeRedirectPath(next, "/"), RedirectType.replace)`. Works without JavaScript. Shown in the
  header's right-hand cluster at every width and again in the footer.
- When there's no `lang` cookie and the browser's Accept-Language doesn't put Icelandic first, show one
  English line above the header: "This site is in Icelandic." + a "Switch to English" button (same form),
  and a "Halda áfram á íslensku" button that sets lang=is so the line goes away.
- i18n modules (lead writes these in W0; everyone uses them):
  - `src/i18n/config.ts`: `LOCALES`, `Locale`, `DEFAULT_LOCALE`, `LOCALE_COOKIE = "lang"`, `isLocale`,
    `INTL_TAG = { is: "is-IS", en: "en-GB" }`, `TIME_ZONE = "Atlantic/Reykjavik"`, `LANGUAGE_NAME`.
  - `src/i18n/translate.ts` (pure): `createT(messages, locale)` → `t(key, params?)`, `t.rich(key, values)`
    (ReactNode, for sentences with links), `t.has(key)`. Plurals are `{ one, other }` objects chosen with
    `Intl.PluralRules` (Icelandic: 21 → one, 11 → other) via `params.count`; numbers in params are
    formatted for the locale. Missing keys throw outside production.
  - `src/i18n/format.ts` (pure): `createFormat(locale)` → `number(n)`, `rating(n|null)` ("4,3"/"4.3",
    null → "—"), `date(d)` ("3. okt. 2026"/"3 Oct 2026"), `monthYear(d)`, `list(items)`.
  - `src/i18n/messages/{is,en}/<area>.ts` and `index.ts`; `src/i18n/messages/index.ts` (server-only)
    exports `MESSAGES`, type `Messages`. English files are `satisfies Shape<typeof is.<area>>`, so keys
    match at compile time. Values are plain data (strings or `{one, other}`).
  - `src/i18n/server.ts` (server-only): `getLocale()`, `getT()`, `getFormat()` (request-cached).
  - `src/i18n/client.tsx`: `I18nProvider` (root layout, `key={locale}`, gets the whole active dictionary),
    `useLocale()`, `useT()`, `useFormat()`.
- Areas (one owner each, both languages): `common, nav, home, browse, profile, reviews, properties, auth,
  account, lookup, report, privacy, validation, meta, errors`.
- Writing rules (also at the top of every Icelandic file):
  - Module-level constants hold message keys, never translated text. Call `t` inside the request.
  - One whole-sentence key per role/kind variant; never build a sentence from noun keys or `${role}s`.
  - Names and addresses only in nominative slots: headings, cards, after a colon ("Leigusali: {name}"),
    or as the subject. Never after a preposition or case-governing verb. A role noun carries the case
    ("Hefur þú leigt af þessum leigusala?").
  - Icelandic: informal "þú"; buttons in the infinitive (Vista, Birta umsögn); instructions imperative
    (Sláðu inn, Veldu); gender-neutral wording (role nouns, "viðkomandi", impersonal/passive voice; no
    participles about the user like skráður/skráð, velkomin(n)); „…“ quotes; "t.d."; decimal comma;
    lowercase months; sort label "A–Ö". Never pluralize a decimal rating: "4,3 af 5".
  - Vocabulary: leigusali/leigusalar (landlord), leigjandi/leigjendur (renter), eign/eignir (property),
    íbúð (apartment unit), umsögn/umsagnir (review), einkunn, meðaleinkunn, Fyrirsögn, Umsögnin þín,
    Skrifa umsögn, Birta umsögn, Uppfæra umsögn, Breyta, Eyða, aðgangur, Nýskráning, Skrá inn, Skrá út,
    Mínar síður (dashboard), Netfang, Lykilorð, Nafn, Um mig, Eyða aðgangi, Leita, Án aðgangs (no account),
    "Ég er leigusali hér" (claim), "Ekki mín eign" (unlink), (valfrjálst). Stars: 1 Mjög slæmt, 2 Slæmt,
    3 Sæmilegt, 4 Gott, 5 Frábært. English UI keeps the word "kennitala" (glossed once as "Icelandic ID
    number").
- Dates and numbers are formatted in Server Components (client components get formatted strings or use
  `useFormat`).
- Metadata: every page uses `generateMetadata` with `getT()` (no static `metadata` exports). Root title
  template `%s · GossipRent`. `global-error.tsx` is static and bilingual (Icelandic first, then a
  `<div lang="en">`), since no provider exists there.
- Forms: `FormState`/`idleFormState` live in `src/lib/form-state.ts` (client-safe). `message`,
  `fieldErrors` are already-translated strings. zod schemas use message keys `validation.*`;
  `parseForm(schema, formData, t)` translates them (unknown → `validation.invalid`) and sets the banner
  `t("validation.fixHighlighted")`. Never use `z.config()` for the locale.
- Unit tests default to English (the harness jar starts with `lang=en`); e2e defaults to English via
  Playwright `use.storageState` (cookie `lang=en` for localhost); Icelandic gets its own e2e spec.

## 2. Kennitala

`src/lib/kennitala.ts` (pure, no DB), built on `is-kennitala`:
- `parseKennitalaInput(raw: string): ParsedKennitala | null` — `parseKennitala(raw, { clean: "aggressive",
  strictDate: true, robot: allowTestKennitalas() })`, then reject a person (non-temporary) whose birth date
  is in the future or more than 110 years ago, and a company dated in the future.
  `ParsedKennitala = { value: string /*10 digits*/; type: "person" | "company"; temporary: boolean;
  birthDate: Date | null }`. Note: the library no longer checks a check digit, so typos pass.
- `allowTestKennitalas()`: true when `ALLOW_TEST_KENNITALA === "true"`, or when `NODE_ENV !== "production"`
  and `ALLOW_TEST_KENNITALA !== "false"`. (Robot "Gervimaður" numbers 010130-xxx9 are used by demo data.)
- `isAdultKennitala(p: ParsedKennitala, now = new Date())`: persons with a birth date must be ≥ 18.
- `formatKennitala(value)` → "DDMMYY-NNNN".
- `src/lib/kennitala-pattern.ts` (dependency-free, client-safe) holds the one kennitala-like pattern
  (`KENNITALA_LIKE_SOURCE`: six digits, any spaces/hyphens/dashes, four digits), `hasKennitalaShape(text)`
  (anywhere) and `isKennitalaShaped(text)` (the whole string), applied after NFKC and dropping invisible
  characters. Free-text checks, search boxes, the search backstop and the admin script's masking all use it.
- `containsKennitala(text)`: true if text contains `\d{6}[-\s]?\d{4}` that parses. Free-text fields
  (review title/body, bio, property description, names) are rejected with
  `validation.noKennitalaInText`.
- Example in UI hints/docs: "123456-7890" (not a valid number). Never show a real-looking one.

## 3. Schema (src/db/schema.ts → fresh drizzle/0000_init.sql)

users:
- `id uuid pk default random`
- `kennitala char(10) not null`, unique index `users_kennitala_unique`, CHECK `kennitala ~ '^[0-9]{10}$'`
- `is_company boolean not null default false`
- `name text not null`, `name_sort text not null`, `name_search text not null` (see §7)
- `email text` (lower-cased; unique index `users_email_unique`; NULLs allowed), `password_hash text`,
  `joined_at timestamptz` — all three null = profile without an account; CHECK
  `users_account_complete`: `(email is null) = (password_hash is null) and (email is null) = (joined_at is null)`
- `is_landlord`, `is_renter boolean not null default false`, CHECK `users_has_a_role` (at least one)
- `city text`, `bio text`, CHECK `users_profile_text_needs_account`: `email is not null or (city is null and bio is null)`
- `created_at timestamptz not null default now()`
- partial indexes on is_landlord / is_renter; index on name_sort. `deleted_at` is gone.

properties:
- `id`, `address text not null`, `unit text`, `postal_code smallint not null` (CHECK 100–999),
  `description text`, `landlord_id uuid references users on delete restrict`,
  `created_by_id uuid references users on delete set null`, `address_sort text not null`,
  `address_search text not null`, `created_at`.
- `address_search = foldForSearch(\`${address} ${unit ?? ""}\`)`, `address_sort = icelandicSortKey(same)`.
  Unique `(address_search, postal_code)` (Postgres lower() only folds ASCII under the C collation, so
  folding happens in TS). Indexes on landlord_id, postal_code, created_by_id. `city`/`region` are gone.

reviews: unchanged except `subject_user_id` and `property_id` are `on delete restrict`
(author_id stays cascade: closing an account deletes the reviews you wrote).

sessions, auth_attempts: unchanged.

reports (new): `id uuid pk`, `target_kind enum report_target ('review','profile','property','account')`,
`target_id uuid` (nullable for 'account'), `reason enum report_reason ('wrong_person','wrong_name',
'false_or_abusive','personal_data','identity_claimed','other')`, `details text not null` (≤ 2000),
`contact_email text`, `reporter_id uuid references users on delete set null`, `created_at`,
`resolved_at timestamptz`, `resolution text`.

## 4. People and accounts (src/lib/people.ts, server-only — the only module that queries by kennitala)

- An *account* has email + password_hash + joined_at. SQL guard for "is an account":
  `isNotNull(users.passwordHash)` (replaces every `isNull(users.deletedAt)`).
- A *profile without an account* is created when someone reviews a kennitala with no row, or links one as a
  property's landlord. Its name is the one that person typed. Its roles are the roles it was reviewed/linked in.
- Exports (all take a Drizzle `tx` where they write):
  - `findPersonByKennitala(kt) → { id, name, isLandlord, isRenter, isCompany, hasAccount } | null`
  - `ensurePerson(tx, { kennitala, name, isCompany, role }) → { id, created }` — `insert … on conflict
    (kennitala) do nothing`, then `update … set is_<role> = true where kennitala = $1 returning` (this is
    the subject lock; NO KEY UPDATE level).
  - `grantRoleByKennitala(tx, kt, role) → { id, name, … } | null` (UPDATE … RETURNING; null = unknown).
  - `grantRoleById(tx, id, kt, role) → boolean` (UPDATE … WHERE id AND kennitala RETURNING — the profile-page
    match check, nothing written on mismatch).
  - `getOwnKennitala(userId) → string | null` (accounts only: the dashboard, and the own-kennitala check when
    linking a landlord).
  - `hasReviewedProperty(executor, kt, propertyId)`, `isDisclaimedLandlord(executor, kt, propertyId)` (relink).
  - `detachAccount(tx, userId) → "deleted" | "kept"`: removes a login but keeps reviews about the person;
    shared by closing an account and the operator's reset-account.
  - `isNameLocked(tx|db, userId) → boolean`: true if any review is about them, or they're the landlord of a
    property someone else created.
  - `reconcileProfiles(tx, ids)`: for rows *without an account* among ids, `FOR UPDATE SKIP LOCKED`, then in
    new statements set is_landlord = has landlord reviews or is a linked landlord, is_renter = has renter
    reviews, and delete the row if neither (inside a savepoint; a still-referenced error → keep the row).
    *Implemented:* a RESTRICT violation is 23001 on Postgres 18/PGlite and 23503 on Postgres ≤ 17, so code
    uses `isStillReferenced(e)`. Rows that wrote reviews are never deleted (that would cascade their reviews).
    *Implemented:* returns the ids it skipped (locked by another transaction); callers pass them to
    `reconcileSkipped(ids)` after their commit, which reconciles them with a waiting lock.
- Lock order: a transaction that locks both a property and a person locks the property first.
- Signup (`signup` action, fields: kennitala, name, email, password, isRenter, isLandlord, city, next):
  - kennitala via parseKennitalaInput (`validation.kennitala.invalid`); company → field error
    "Company accounts aren't available yet."; person under 18 → "You must be 18 or older to sign up.";
  - hash the password first, then one transaction: insert … on conflict (kennitala) do nothing; else lock
    the existing row FOR UPDATE (it must have no account), check isNameLocked in a new statement, then
    set email, password_hash, joined_at=now(), city, bio=null, roles = existing OR chosen, and the typed
    name unless locked; delete any sessions left on the row (at most 3 tries if the row vanishes). An
    existing account → field error on kennitala:
    "This kennitala already has an account." plus a link "Not you? Report it" to /report?target=account.
    23505 on users_email_unique → email field error as today. Other errors → sanitizeDbError.
  - If the claimed profile kept its name, the dashboard shows a notice explaining the name comes from reviews.
- Login: by email; only accounts match. The session is stored only if the password hash just checked is still
  current, and readSessionUser ignores sessions older than the account's joined_at, so a login racing a
  reset or close can't leave a session behind for whoever takes the profile over next.
- updateProfile: refuses a name change while `isNameLocked` ("Your name can't be changed after people have
  reviewed you. If it's wrong, report it."); only accounts can update.
- changeRole: unchanged rules (can't drop a role you've been reviewed in; dropping landlord unlinks your
  properties, records a property_disclaimers row for each, and clears landlord_confirmed).
- deleteAccount (close): `SELECT … FOR UPDATE` on self (must be an account); delete reviews they wrote
  (returning subjects); delete sessions; then, in new statements: reviewedAsLandlord, reviewedAsRenter,
  linkedAsLandlord. None → delete the row. Otherwise clear email/password_hash/joined_at/city/bio, set
  is_landlord = reviewedAsLandlord || linkedAsLandlord, is_renter = reviewedAsRenter, and KEEP property links.
  Then reconcileProfiles(subjects of their deleted reviews). Signing up again with the same kennitala
  reclaims the profile. Confirmation copy says reviews about you stay.
- Nothing in the app ever deletes or hides a review about someone except the review's author or the
  operator (scripts/admin.ts).

## 5. Reviews (src/app/actions/reviews.ts)

Shared server core `saveReviewCore` used by:
- `saveReview(prev, formData)` — profile/property page form. Fields: `kind`, `subjectId`,
  `subjectKennitala` (landlord/renter only), `rating`, `title`, `body`.
- `reviewWizard(prev, formData)` — /reviews/new. Fields: `intent` ("check" | "save"), `kind`
  ("landlord"|"renter"), `subjectKennitala`, `subjectName` (new profile only), `confirmNew` ("on"; new
  profile only), `rating`, `title`, `body`. Returns `WizardState = FormState & { step: "kennitala" |
  "review"; subject?: { id: string | null; name: string | null; hasAccount: boolean; isCompany: boolean;
  formattedKennitala: string; birthDate: string | null /* formatted */ } }`. intent=check: look up and
  return step "review" (found → show "This kennitala belongs to <name>"; not found → ask for name +
  confirm). If the author already reviewed that person in that kind → redirect(303) to their profile
  `#your-review`. intent=save success → redirect(303) to `/{landlords|renters}/{id}?saved=1#your-review`.

Transaction order (one transaction, refusals after a write call `tx.rollback()`):
1. Author: `SELECT id, kennitala, is_landlord, is_renter … WHERE id = me AND password_hash IS NOT NULL
   FOR KEY SHARE`. Must have the reviewer role (renters review landlords and properties; landlords review renters).
2. Pure checks: parse kennitala; `kt === author.kennitala` → "That's your own kennitala."; minor →
   "We can't accept a review for this kennitala." (neutral); text contains a kennitala → field error.
3. Existing review by (author, subjectId|resolved id, kind)? → update it; no kennitala needed for an edit
   from the profile page (decided from the reviews table inside the tx, never from a form flag).
4. New review, profile page: `grantRoleById(tx, subjectId, kt, kind)`; false → mismatch:
   "That kennitala doesn't match this profile. Several people can share a name, so check you're on the
   right page." (identical whether the number is unknown or someone else's).
   New review, wizard: found → `grantRoleByKennitala`; not found → require `subjectName` (name rules §7)
   and `confirmNew`, then `ensurePerson` (is_company from the parsed type).
5. Insert in a savepoint (23505 → update, as today). Revalidate the subject's pages.
- Property reviews: unchanged rules (renters only; not the property's landlord), no kennitala.
- Rate limits (§9): every kennitala check consumes `kt:user` (+ `kt:ip`); a profile-page match releases
  it. There is deliberately no per-profile cap: it let one account block every new review of a profile.
  New reviews consume `review-new:user`; new profiles consume `profile-new:user`.
- Review prompts (no payment/debt questions — possible Act 90/2018 art. 15 issue):
  landlord: "Did they answer quickly and fix things? Was the lease fair, and did you get the deposit back?"
  renter: "How did they look after the home? How was communication, including with neighbours?"
  property: "What's it like to live there? Heating, damp or mould, noise, laundry, parking, the area…"
  Above every review form, short guidelines: no debts or money owed, health, criminal accusations,
  family details, or anyone's kennitala, phone number or address.
- deleteReview: author only; then reconcileProfiles([subject]) for person reviews, reconcileSkipped after
  commit; if the profile is gone, the author is sent to /dashboard.

## 6. Properties (src/app/actions/properties.ts)

- Form fields: `address` ("Address", hint e.g. "Njálsgata 23"), `unit` ("Apartment (optional)", hint
  "e.g. 0201 (floor 02, flat 01) or 2nd floor left"), `postalCode` (`<select>`, "Postcode", first option
  "Choose a postcode", then non-PO-box codes, value "101", text "101 Reykjavík"), `description`,
  `relation` (own|rent, both-role users only, as today), `landlordKennitala` ("Landlord's kennitala
  (optional)"), `landlordName` ("Landlord's name", only needed when the kennitala is new),
  `confirmNewLandlord` ("on"), and a secondary submit `intent=check` ("Check") that reports who the
  kennitala belongs to without saving (same rate limit as other kennitala checks).
- Normalize: NFC, collapse whitespace; strip a leading "íbúð", "íb.", "apt", "apt.", "unit" (whole word) or
  "#" from unit, with any separator after it (one rule, `normalizeUnit` in text.ts, used everywhere).
- Landlord link: "own" → yourself (must be a landlord). "rent" + kennitala → found: grant landlord role
  (also to a renter-only *account*); not found: needs name + confirm → ensurePerson. Your own kennitala
  is refused. Minors refused (neutral message).
- `updatePropertyLandlord(prev, formData)` intents: `claim` (as today), `unlink` (as today, "Not my
  property"), `relink` (creator only, while the linked landlord has no account: new kennitala/name/confirm
  or empty to clear; then reconcileProfiles on the old landlord).
- `properties.landlord_confirmed`: true when the landlord listed the property as their own or claimed it,
  false when a renter named them (link or relink) or after an unlink. Pages show "Added by a renter, not
  confirmed" only when it's false and the landlord has no account. The property and its reviews always stay.
- "Not my property" sticks: unlink (and dropping the landlord role) writes a `property_disclaimers` row;
  relink and its check refuse a disclaimed person, and anyone who has reviewed the property; a claim by the
  landlord confirms the link and deletes their disclaimer.
  *Implemented:* `updatePropertyLandlord` also accepts `intent=check` so the creator's relink form can look a
  kennitala up first (counted like every other kennitala check).
- Display: `PropertyAddress` component: line 1 "Njálsgata 23, íbúð 0201" (a unit of 1–4 digits with an
  optional letter, or a lone letter, gets the localized "íbúð"/"apt." prefix; other units as typed),
  line 2 "101 Reykjavík".

## 7. Text, names, search, sorting (src/lib/text.ts, src/lib/postcodes.ts — lead writes in W0)

- `normalizeText(s)`: NFC, trim, collapse whitespace.
- `foldForSearch(s)`: lower + á→a é→e í→i ó→o ú→u ý→y ö→o ð→d þ→th æ→ae (also applied to queries).
- `icelandicSortKey(s)`: maps letters to ranks of `a á b d ð e é f g h i í j k l m n o ó p r s t u ú v x y ý þ æ ö`
  (others after), so ORDER BY the key gives A–Ö.
- Names (`validation.name.*`): 2–80 chars after normalizing; persons: letters (any script), spaces,
  hyphen, apostrophe, period; companies may also use digits and "&"; no "@", URLs or kennitalas.
- postcodes.ts (from `postnumer`): `HOME_POSTCODES` (non-PO-box, numeric order, `{ code, place }`),
  `isHomePostcode(n)`, `placeName(code)` (falls back to String(code)), `postcodesMatching(word)`
  (accent/case-folded match on place names, plus exact code).
- Property search: each word matches `address_search`/folded unit, or `postal_code` in
  `postcodesMatching(word)`. People search: `name_search` (folded) plus city for accounts.
- Sort "name" uses name_sort / address_sort ("A–Ö").

## 8. Browse, lookup, privacy

- Directories list profiles with and without accounts; badge "No account" / "Án aðgangs". Profiles
  without an account: no "Member since" (show "First reviewed {month year}"), and the note: "This person
  doesn't have a GossipRent account and doesn't manage this page. The name may have been entered by
  someone else. Is this you? Sign up with your kennitala to take over the page. Reviews others wrote about
  you stay on it." (true however the page came to exist). Accounts show "Identity not verified".
- The home page is indexed, so its latest reviews show only property reviews and landlord reviews whose
  subject has an account or is a company (never renter reviews or people without an account).
- Profile pages: `/renters/[id]` always `robots: noindex, nofollow`; `/landlords/[id]` too when it's a
  person without an account. `src/app/robots.ts` disallows /renters, /search, /reviews, /dashboard, /report.
- Kennitala lookup (`lookupKennitala(prev, formData)`, field `kennitala`, button "Look up", heading
  "Look up a kennitala"): POST only, login required ("Log in to look up a kennitala."), rate limited.
  Found → redirect(303) to the profile. Not found → "Nobody with this kennitala has been reviewed yet." +
  link "Write the first review" (/reviews/new). Shown under the search box on home and /search.
- GET search with a kennitala-shaped `q` (home, /search, directories): never search or echo it;
  redirect to `/search?kt=1` (*Implemented:* 307 — a Server Component's redirect() is always 307 for GET), which shows "To look up a kennitala, use the form below." above the
  lookup form, with the lookup field autofocused. The search box (client) also intercepts a kennitala-shaped
  submit and focuses the lookup form.
- `/privacy` page (footer link "Privacy" / "Persónuvernd"): why kennitalas are used (reliably telling
  namesakes apart), that they're never shown, that identities aren't verified, that people can't remove
  reviews about them but can report problems, closed accounts, contact.
- Footer also says "Reviews are the opinions of their authors. Identities aren't verified."

## 9. Rate limits (src/lib/auth/rate-limit.ts RATE_LIMITS; keys never contain a kennitala)

`kennitalaChecksPerUser: 10 / 15 min` and `kennitalaChecksPerUserDaily: 50 / 24 h` (key `kt:user:<id>`,
two windows on two keys `kt:user15:` and `kt:userday:`), `kennitalaChecksPerIp: 100 / 24 h` (`kt:ip:<ip>`,
only when the IP is known), `newReviewsPerAuthor: 20 / 24 h` (`review-new:user:<id>`), `newProfilesPerAuthor: 5 / 24 h`
(`profile-new:user:<id>`), `reportsPerUser: 10 / 24 h`, `reportsPerIp: 20 / 24 h`.
Over a limit: "Too many attempts. Please try again later." (existing wording). AUTH_RATE_LIMIT=off disables all.

## 10. Reports and operator tools

- `/report?target=review|profile|property|account&id=<uuid>` page + `createReport` action: fields
  `reason` (select), `details` (required, ≤ 2000), `contactEmail` (optional; required when logged out).
  Success: "Thanks. We'll look into it." Links: "Report" on every review card, "Report this page" on
  profiles and properties, "Not you? Report it" on the signup already-has-an-account error.
- `scripts/admin.ts` (`npm run admin -- <command>`; commands in scripts/admin-commands.ts): `reports` (list unresolved), `resolve <reportId>
  <note>`, `remove-review <reviewId>`, `reset-account <userId>` (clear email/password/joined_at/city/bio,
  delete sessions; never touches reviews about them), `rename-profile <userId> <name>`,
  `relink-property <propertyId> <kennitala|none>`. Uses `connect()` like scripts/seed.ts; never prints kennitalas,
  and escapes control characters in everything it prints (report text comes from the public).
  *Implemented:* reset-account uses detachAccount (deletes a row nothing refers to); relink-property follows the
  app's relink rules (refuses reviewers and disclaimed landlords; clears landlord_confirmed).

## 11. Demo data (src/db/demo-people.ts pure data + src/db/seed.ts)

- Persons use Gervimaður numbers 010130-xxx9 (xxx ∈ 212, 220, 239, 247, 255, 263, 271, 298, 301, 336, 433,
  492, 506, 778); company 4505352068 ("Dæmi leigufélag ehf.", dated 1835). Password `password123`.
- Accounts: Sigrún Helgadóttir (sigrun@example.com, landlord, 107 Reykjavík), Ólafur Þór Gunnarsson
  (olafur@example.com, landlord in Akureyri who also rents), Kári Snær Einarsson (kari@example.com, renter),
  Ásdís Halldórsdóttir (asdis@example.com, renter, Hafnarfjörður), Agnieszka Nowak (agnieszka@example.com,
  renter, writes one review in English), Birta Líf Kristinsdóttir (birta@example.com, renter, Akureyri),
  plus enough others to keep directories paginating like today if tests need it.
- Profiles without an account: Gunnar Már Pétursson (landlord, Kópavogur) and Dæmi leigufélag ehf. (company
  landlord), both reviewed.
- Properties: Njálsgata 23 íbúð 0201 101; Hringbraut 79 107; Hamraborg 14 íbúð 0503 200; Strandgata 31 220;
  Hafnargata 50 230; Þórunnarstræti 112 600; Austurvegur 22 800. Reviews in Icelandic about deposits
  (trygging), indexed rent, damp/mould, hússjóður, heating, laundry, noise, parking — no payment/debt claims.
- Flags derived from the seeded reviews/links. `DEMO` exported for e2e.

## 12. Tests

- Unit: shared harness `tests/unit/support/harness.ts` (fake next/headers with a cookie jar starting at
  `lang=en`, RedirectSignal, form(), outcome(), logInAs, createUser (with kennitala), insertProperty
  (postalCode), insertReview, unique, freshIp). Domain files: accounts, reviews, properties, lookup/reports,
  i18n, kennitala, text/postcodes, seed, migrations, validation, data-helpers, rate-limit, password, db, roles.
  Race tests also run under UNIT_DATABASE_URL (real Postgres).
- E2E: English by default; `freshKennitala()` helper (unique per run, birth date 1960–2000);
  new specs: `icelandic.spec.ts` (default language, switch with and without JS keeps URL+query, header fits at
  390/320 px), `kennitala.spec.ts` (wizard, profile mismatch, lookup, kennitala never in other people's
  pages/RSC/URLs), `reports.spec.ts`.
