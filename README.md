# LoveLink — Meet. Match. Connect. ❤️

Mobile-first dating web app for Ethiopia. Built with Node + Express + EJS +
PostgreSQL (`pg`), following the SiraLink platform pattern.

- **18+ only** — signup rejects anyone under 18. One phone = one account.
- **Onboarding questionnaire** — bio, city + real GPS location (lat/lng stored,
  distance in km shown, Discover sorted nearest-first), height, religion,
  education, job, smoking/drinking, kids, looking-for gender + age range,
  relationship goal, interests, languages, up to 3 photos (base64 in DB, 3MB cap).
- **Matching** — match score (0–100%) from shared interests, age-range fit,
  distance, goal and lifestyle. Like / pass / super-like / rewind-once.
  A match + chat conversation is created **only** when both like each other.
- **Chat** — only inside a match. 2s polling, optimistic send, image messages,
  unread badges, report + block.
- **Explore** — grid of nearby / online / new profiles, age + distance filters.
- **Paywall** — first **3 matches free**. The 4th mutual like is blocked and
  the user is sent to Premium: pay `PREMIUM_FEE_ETB` (default 99 ETB) via
  Telebirr / CBE (`TELEBIRR_NUMBER` / `CBE_NUMBER` env vars), upload a receipt
  photo, admin approves → Premium (unlimited matches/messages). Enforced
  server-side, never client-only.
- **Admin panel** (`/admin`) — tappable stat cards, users + detail (ban/unban,
  grant Premium, delete), premium receipt approve/reject, reports queue
  (dismiss / ban), delete-all-demo-data in one action.

## Run locally

```bash
npm install
USE_PGMEM=1 node server.js   # http://localhost:3000 (in-memory DB, fresh seed each start)
```

Production: set `DATABASE_URL` (Neon Postgres) and deploy by pushing to GitHub
(Render auto-deploys). Optional env: `SEED_DEMO=1`, `ADMIN_PASSWORD`,
`PREMIUM_FEE_ETB`, `TELEBIRR_NUMBER`, `CBE_NUMBER`, `BREVO_API_KEY`
(email verification / password reset; without it the links print to the server
log in dev), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google sign-in),
`SESSION_SECRET`, `BASE_URL`.

## Demo logins (seed data — delete from Admin before real users)

| Who | Phone | Password |
| --- | --- | --- |
| Admin | 0911000000 | admin123 |
| Abel Tesfaye (demo user, male, 26, Addis Ababa) | 0922000111 | password123 |
| Selam Tesfaye (24) | 0922000222 | password123 |
| Sara Mekonnen (25) | 0922000333 | password123 |
| Mimi Alemu (27) | 0922000444 | password123 |
| Daniel Haile (26) | 0922000555 | password123 |
| Ruth Girma (26) | 0922000666 | password123 |

Demo notes: **Selam already liked Abel** — when Abel likes her back it is an
instant match. Sara ↔ Daniel are already matched with a chat thread. Mimi has
a pending Premium receipt for the admin to approve. Sara reported Daniel.

Demo photos: Pexels (Pexels License, free to use). See
`public/img/demo-photos.json` for photographer + source links. All demo users
are marked `is_demo` and can be deleted in one click from Admin → Delete demo data.

## Project layout

```
server.js            thin boot + middleware (gzip, sessions, lang, unread badge)
db/schema.sql        tables + indexes (every FK / hot path)
db/seed.js           admin + 6 demo profiles + 1 match + 1 pending payment + 1 report
db/index.js          pg Pool or pg-mem when USE_PGMEM=1
lib/match.js         haversine distance + match score + mutual-match creation
routes/auth.js       signup/signin/verify/forgot-reset (+Google when configured)
routes/discover.js   onboarding, Discover swipe, Explore, Matches, public profiles
routes/messages.js   match-only chat (2s poll, optimistic, images)
routes/premium.js    paywall + receipt upload
routes/admin.js      dashboard, users, payments, reports, delete-demo
views/               layout.ejs (drawer + bottom nav) + one page per screen
public/css/style.css mobile-first pink theme, 390px tested
i18n.js              English + Amharic strings
```
