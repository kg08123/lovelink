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

## v2 (2026-11-08) — design + gate + speed fixes

- **Design matches the mockup**: dark hero landing with a real Pexels couple-at-sunset
  photo (`public/img/hero-couple.jpg`, Capture Point, Pexels 40455799), pink gradient
  buttons, round Google/Apple/Facebook sign-in buttons with real brand SVGs, Discover
  card with info overlaid on the photo, round rewind/pass/like/super-like buttons,
  dark "It's a Match!" screen, blue/grey chat bubbles, mockup-style Settings list.
- **No emoji anywhere in the UI** — every icon is an inline SVG from `lib/icons.js`
  (`icon()` / `brand()`); verified by scanning all views/CSS/JS.
- **Questionnaire gate**: a signed-in user with no profile is redirected to
  `/onboarding` from every page (Discover, Explore, Matches, Messages, Settings,
  Premium, home) and sees no nav to those pages until the answers are saved.
- **Photos never block saving**: photos are shrunk in the browser (canvas, max 800px
  JPEG) and again server-side with Sharp (max 720px, ~60-150KB) before storing, so a
  10MB phone photo saves in under a second. Upload cap is 20MB; failures show a
  clear message and keep the typed answers.
- **Speed**: Discover/Explore fetch slim columns (photo1 only, 40 candidates max)
  instead of all base64 photos; user+profile load in one JOIN query; unread-badge
  queries are skipped on landing/auth/onboarding pages. `GET /health` is a
  no-DB endpoint for the keep-alive cron (ping every 10 min so Neon/Render stay warm).

## v3 (2026-11-08) — UI polish + more demo users

- **No unstyled native elements**: every link now has no underline by default
  (`.link` for inline links); onboarding photos use styled upload zones with
  thumbnail preview + file name + X to remove (the browser's "Choose file"
  button never shows); receipt upload has an X too; selects have a pink
  chevron; checked interest chips turn pink; admin quick actions are styled
  rows; admin table names are dark bold links; row-action buttons stay compact.
- **Header/drawer trimmed**: header message icon removed (unread badge lives
  on the bottom-nav Messages tab); drawer for regular users no longer lists
  Profile, Messages or Matches (already in the bottom nav) — only Discover,
  Explore, Premium, Settings, About, Sign Out. Admin drawer unchanged.
- **CSS cache-bust**: stylesheet is now `style.css?v=3`, so phones stop
  serving the old cached stylesheet.
- **16 demo profiles** (was 6): Helina, Tigist, Bethlehem, Hanna, Meron,
  Yonas, Dawit, Nahom, Fitsum, Kaleb — Addis Ababa, Hawassa, Bahir Dar,
  Mekelle, Adama; Pexels portraits, each looked at before use (2 rejects:
  photos that looked too old for their age, 1 bare-chest Kente portrait
  swapped for a clothed one). 4 of them pre-liked Abel; 2 extra matched
  pairs with chat threads.
- **Live catch-up**: the boot seed only runs on an empty database, so a live
  site that already has users gets the 10 new demos from Admin → "Add missing
  demo users" (`POST /admin/seed-demo`, idempotent — second run adds nothing).

Production: set `DATABASE_URL` (Neon Postgres) and deploy by pushing to GitHub
(Render auto-deploys). Optional env: `SEED_DEMO=1`, `ADMIN_PASSWORD`,
`PREMIUM_FEE_ETB`, `TELEBIRR_NUMBER`, `CBE_NUMBER`, `BREVO_API_KEY`
(email verification / password reset; without it the links print to the server
log in dev), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google sign-in),
`SESSION_SECRET`, `BASE_URL`.

## v6 (2026-11-10) — loading screen, selfie verification, new demos, removal

- **Discover loading screen**: "Finding Your Matches" — maroon gradient,
  pulsing pink heart with 4 orbiting icon chips, animated dots + progress
  bar; fades when the first card is ready, hard-capped at 3s, bottom nav
  stays visible above it.
- **Selfie verification** (`/verify`): user takes a selfie in the reference
  pose (camera capture), admin reviews it side by side with the profile
  photo in Admin → Verifications, approve grants the blue verified badge +
  notifies the user, reject sends them to retake. The badge now means
  selfie-verified OR demo (was email-verified OR demo). Selfies are shown
  only to the admin, never on any public profile.
- **15 new modern demos** (10 girls, 5 boys): stylish young adults, modern
  clothes, city / café / nightlife / street style — NOT traditional dress.
  Pexels, Ethiopian photographers only, every photo looked at.
- **Recently Online**: real presence from `last_active` — online <5 min
  (green), recently online <24h (amber), none otherwise. Shown on Discover,
  Likes, public profile, inbox and chat thread.
- **Old demo people REMOVED** (user order): the original 16 + the 15
  cultural profiles from 2026-11-10 were deleted from the seed and from live
  (`POST /admin/delete-old-demos`, keeps the 15 new + Abel + admin). The seed
  now contains ONLY the 15 new demos, so "Add missing demo users" can never
  bring the old ones back. Abel (0922000111) is kept LIVE only — not in the
  seed. No pre-seeded likes/matches/chats exist any more; demo auto-match
  (60s like-back) still works for real users and Abel.

## Demo logins (seed data — delete from Admin before real users)

| Who | Phone | Password |
| --- | --- | --- |
| Admin | 0911000000 | admin123 |
| Abel Tesfaye (test account, male, 26, Addis Ababa) — LIVE ONLY, not in the seed | 0922000111 | password123 |
| Ayana Bekele (23, Addis Ababa) — 3 photos | 0922003232 | password123 |
| Helen Teshome (25, Addis Ababa) — 2 photos | 0922003333 | password123 |
| Feven Girma (22, Hawassa) | 0922003434 | password123 |
| Kidist Alemu (24, Bahir Dar) | 0922003535 | password123 |
| Mihret Haile (21, Gondar) | 0922003636 | password123 |
| Yodit Fikre (26, Addis Ababa) | 0922003737 | password123 |
| Netsanet Worku (24, Mekelle) | 0922003838 | password123 |
| Genet Tadesse (27, Dire Dawa) | 0922003939 | password123 |
| Almaz Kassa (20, Jimma) | 0922004040 | password123 |
| Eyerusalem Gebru (19, Adama) | 0922004141 | password123 |
| Yared Tesfaye (26, Addis Ababa) — 3 photos | 0922004242 | password123 |
| Fikre Alemayehu (24, Hawassa) | 0922004343 | password123 |
| Samson Haile (27, Bahir Dar) | 0922004444 | password123 |
| Getnet Berhe (23, Mekelle) | 0922004545 | password123 |
| Mikiyas Worku (25, Dessie) | 0922004646 | password123 |

Demo notes: all 15 are modern, stylish young adults — no traditional dress,
no cultural scenes. No pre-seeded likes or matches; a demo likes back 60s
after a real user (or Abel) likes them, so matches feel alive.

Demo photos: Pexels (Pexels License, free to use). See
`public/img/demo-photos.json` for photographer + source links. All demo users
are marked `is_demo` and can be deleted in one click from Admin → Delete demo data.

## Project layout

```
server.js            thin boot + middleware (gzip, sessions, lang, unread badge)
db/schema.sql        tables + indexes (every FK / hot path)
db/seed.js           admin + 15 modern demo profiles (old demos removed 2026-11-10)
db/index.js          pg Pool or pg-mem when USE_PGMEM=1
lib/match.js         haversine distance + match score + mutual-match creation
routes/auth.js       signup/signin/verify/forgot-reset (+Google when configured)
routes/discover.js   onboarding, Discover swipe, Explore, Matches, public profiles
routes/messages.js   match-only chat (2s poll, optimistic, images)
routes/premium.js    paywall + receipt upload
routes/admin.js      dashboard, users, payments, reports, verifications, delete-demo, delete-old-demos
views/               layout.ejs (drawer + bottom nav) + one page per screen
public/css/style.css mobile-first pink theme, 390px tested
i18n.js              English + Amharic strings
```
