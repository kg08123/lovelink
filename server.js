const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');
const db = require('./db');
const { t, nt, CITIES, cityName, INTERESTS } = require('./i18n');
const { icon, brand } = require('./lib/icons');
const { googleEnabled, passport } = require('./lib/google');

const app = express();
const PORT = process.env.PORT || 3000;
const PREMIUM_FEE = Number(process.env.PREMIUM_FEE_ETB || 99);
const FREE_MATCHES = 3;

// Production boot: ensure schema on Render + Neon (idempotent).
if (process.env.DATABASE_URL && !process.env.USE_PGMEM) {
  const fs = require('fs');
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  db.query(schema)
    .then(() => console.log('schema ensured'))
    .then(async () => {
      if (process.env.SEED_DEMO === '1') {
        const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users');
        if (rows[0].n === 0) {
          console.log('seeding demo data...');
          await require('./db/seed').main({ keepAlive: true });
        } else console.log('seed skipped: users exist');
      }
      if (process.env.ADMIN_PASSWORD) {
        const bcrypt = require('bcryptjs');
        const h = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
        await db.query("UPDATE users SET password_hash=$1 WHERE role='admin'", [h]);
        console.log('admin password rotated');
      }
    })
    .catch((e) => console.error('boot data failed:', e.message));
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

if (googleEnabled && passport) app.use(passport.initialize());

app.use(session({
  secret: process.env.SESSION_SECRET || 'lovelink-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

// Language: ?lang=am|en overrides, else cookie, else 'en'
app.use((req, res, next) => {
  if (req.query.lang === 'en' || req.query.lang === 'am') {
    res.cookie('lang', req.query.lang, { maxAge: 1000 * 60 * 60 * 24 * 365 });
    req.lang = req.query.lang;
  } else {
    req.lang = req.cookies.lang === 'am' ? 'am' : 'en';
  }
  res.locals.lang = req.lang;
  // Theme: cookie wins ('dark' | 'light'); no cookie = 'dark' server-side,
  // and the <head> boot script then applies the stored choice, else dark.
  // The reference design is dark-first, so dark is the default; light
  // stays available from the Settings toggle.
  res.locals.theme = req.cookies.theme === 'light' ? 'light' : 'dark';
  res.locals.t = (key) => t(req.lang, key);
  res.locals.nt = (stored) => nt(req.lang, stored);
  res.locals.googleEnabled = googleEnabled;
  res.locals.fmtETB = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US') + ' ETB');
  res.locals.icon = icon;
  res.locals.brand = brand;
  // Bottom-nav active tab, derived from the URL. Heart tab = Likes now.
  res.locals.navActive = req.path.startsWith('/discover') || req.path.startsWith('/u/')
    ? 'discover'
    : req.path.startsWith('/likes')
      ? 'likes'
    : req.path.startsWith('/matches') || req.path.startsWith('/match/')
      ? 'messages'
      : req.path.startsWith('/messages')
        ? 'messages'
        : req.path.startsWith('/profile') || req.path.startsWith('/settings') || req.path.startsWith('/premium') || req.path.startsWith('/verify')
          ? 'profile'
          : '';
  res.locals.APP_VERSION = require('./package.json').version || '1.0.0';
  res.locals.CITIES = CITIES;
  res.locals.cityName = cityName;
  res.locals.INTERESTS = INTERESTS;
  res.locals.PREMIUM_FEE = PREMIUM_FEE;
  res.locals.FREE_MATCHES = FREE_MATCHES;
  res.locals.TELEBIRR_NUMBER = process.env.TELEBIRR_NUMBER || '';
  res.locals.CBE_NUMBER = process.env.CBE_NUMBER || '';
  res.locals.qs = (over) => {
    const q = Object.assign({}, req.query, over);
    Object.keys(q).forEach((k) => { if (q[k] === '' || q[k] == null) delete q[k]; });
    delete q.lang;
    return new URLSearchParams(q).toString();
  };
  next();
});

// Presence: real last_active for the "Online / Recently Online" labels.
// Throttled to one UPDATE per user per 5 min (in-memory) so the 3s chat
// poll never hammers the DB. Fire-and-forget, never blocks the request.
const lastSeenTouch = new Map();
const LAST_SEEN_MS = 5 * 60 * 1000;
function touchLastSeen(userId) {
  const last = lastSeenTouch.get(userId) || 0;
  if (Date.now() - last < LAST_SEEN_MS) return;
  lastSeenTouch.set(userId, Date.now());
  db.query("UPDATE profiles SET last_active=NOW() WHERE user_id=$1 AND last_active < NOW() - INTERVAL '5 minutes'", [userId])
    .catch(() => {});
}

// Attach logged-in user + profile to request + views.
// One JOIN query instead of two, and the unread/notification counts are
// skipped on landing/auth/onboarding pages where no badge is shown anyway.
const BADGE_SKIP = ['/', '/onboarding', '/signup', '/signin', '/verify-email', '/forgot-password', '/reset-password', '/about', '/privacy', '/profile/edit'];
app.use(async (req, res, next) => {
  req.user = null;
  req.profile = null;
  // The chat poll hits this middleware every few seconds. It needs req.user
  // but never renders a photo, so for JSON polls the profile row is loaded
  // WITHOUT the base64 photo columns (they are ~60-150KB each and would be
  // pulled from the DB on every poll for nothing). The row itself must still
  // load — the questionnaire gate below redirects when req.profile is null.
  // Only for read-only GET polls: POST mutations (photo reorder/remove,
  // swipes) run over XHR too and MUST see the full profile row — an XHR
  // photo reorder once read photo1 as undefined and wrote NULLs over all
  // three photos. Never slim-load on a POST.
  const isJsonPoll = (req.xhr || req.path.endsWith('/json')) && req.method === 'GET';
  if (req.session.userId) {
    try {
      const r = await db.query(
        `SELECT u.*,
                p.user_id AS p_user_id, p.bio AS p_bio, p.city AS p_city, p.country AS p_country,
                p.latitude AS p_latitude, p.longitude AS p_longitude,
                p.height_cm AS p_height_cm, p.religion AS p_religion, p.education AS p_education,
                p.job AS p_job, p.smoking AS p_smoking, p.drinking AS p_drinking, p.kids AS p_kids,
                p.looking_for_gender AS p_looking_for_gender, p.age_min AS p_age_min, p.age_max AS p_age_max,
                p.relationship_goal AS p_relationship_goal, p.interests AS p_interests,
                p.languages AS p_languages, p.zodiac AS p_zodiac, p.birth_place AS p_birth_place,
                p.incognito AS p_incognito, p.verified_only AS p_verified_only, p.pref_religion AS p_pref_religion,
                ${isJsonPoll ? '' : 'p.photo1 AS p_photo1, p.photo1_thumb AS p_photo1_thumb, p.photo2 AS p_photo2, p.photo2_thumb AS p_photo2_thumb, p.photo3 AS p_photo3, p.photo3_thumb AS p_photo3_thumb,'}
                p.online AS p_online, p.last_active AS p_last_active, p.created_at AS p_created_at
         FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id=$1`,
        [req.session.userId]);
      if (r.rows.length) {
        const row = r.rows[0];
        req.user = row;
        if (row.p_user_id) {
          req.profile = {};
          for (const k of Object.keys(row)) {
            if (k.startsWith('p_')) req.profile[k.slice(2)] = row[k];
          }
        }
      } else delete req.session.userId;
    } catch (e) { return next(e); }
  }
  res.locals.user = req.user;
  res.locals.profile = req.profile;
  res.locals.unreadCount = 0;
  // Stamp real activity for presence (see touchLastSeen above).
  if (req.user && req.profile) touchLastSeen(req.user.id);
  // Chat speed: the thread poll hits this middleware every few seconds.
  // Badge counts are useless on JSON/XHR endpoints (nothing renders them)
  // and on /health, so skip those 2 extra queries there.
  const skipBadges = req.path === '/health' || isJsonPoll
    || BADGE_SKIP.some((p) => req.path === p || req.path.startsWith(p + '/'))
    || req.path.startsWith('/auth/google');
  if (req.user && !skipBadges) {
    try {
      const u = await db.query(
        `SELECT COUNT(*)::int AS n FROM messages m JOIN conversations c ON c.id=m.conversation_id
         LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=$1
         WHERE (c.user_a_id=$1 OR c.user_b_id=$1)
           AND m.sender_user_id<>$1 AND m.created_at > COALESCE(r.last_read_at, '1970-01-01')`,
        [req.user.id]);
      res.locals.unreadCount = u.rows[0].n;
    } catch (e) { /* tables may not exist on first boot */ }
    try {
      const n = await db.query(
        "SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND is_read=FALSE",
        [req.user.id]);
      res.locals.unreadCount += n.rows[0].n;
    } catch (e) { /* table may not exist on first boot */ }
  }
  next();
});

// Questionnaire gate: a signed-in regular user with NO profile sees ONLY the
// questionnaire. No Discover, Explore, home feed, messages, settings or
// premium until the answers are saved.
app.use((req, res, next) => {
  if (req.user && req.user.role === 'user' && !req.profile) {
    const p = req.path;
    const allowed = p === '/onboarding' || p === '/profile/edit'
      || p === '/signin' || p === '/signout' || p === '/signup' || p === '/signup/google'
      || p.startsWith('/verify-email') || p.startsWith('/forgot-password')
      || p.startsWith('/reset-password') || p.startsWith('/auth/google')
      || p === '/about' || p === '/privacy';
    if (!allowed) return res.redirect('/onboarding');
  }
  next();
});

// Flash messages (simple, session-based)
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// Health check for the keep-alive cron. It runs a tiny `SELECT 1` so the
// ping wakes the Neon database too — the old version touched nothing, so
// Render stayed awake while Neon still slept ~5 min after idle and the
// next real click paid a database wakeup. Cheap (one trivial query) and
// safe: if the DB is down it answers 503 instead of crashing.
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false });
  }
});

// Demo auto-match backup: every 30s, let demo users like back any
// 60s-old likes (lib/demo-auto). Page-load sweeps are the reliable path
// (the free tier sleeps); this only helps while the server is awake.
// Guarded so overlapping runs and failures never crash the server.
let demoSweepRunning = false;
const demoSweepTimer = setInterval(async () => {
  if (demoSweepRunning) return;
  demoSweepRunning = true;
  try {
    const { processAllDemoAutoMatches } = require('./lib/demo-auto');
    await processAllDemoAutoMatches();
  } catch (e) { console.error('[demo-auto] interval sweep failed:', e.message); }
  demoSweepRunning = false;
}, 30000);
if (demoSweepTimer.unref) demoSweepTimer.unref();

app.use('/messages', require('./routes/messages'));
app.use('/premium', require('./routes/premium'));
app.use('/settings', require('./routes/settings'));
app.use('/verify', require('./routes/verify'));
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/discover'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => res.status(404).render('404'));
// 500
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500', { error: process.env.NODE_ENV === 'production' ? null : String(err && err.stack || err) });
});

if (require.main === module) {
  (async () => {
    if (process.env.USE_PGMEM === '1') await require('./db/seed').main({ keepAlive: true });
    app.listen(PORT, () => console.log(`LoveLink on http://localhost:${PORT} (lang cookie: en|am)`));
  })().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = app;
