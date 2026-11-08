const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');
const db = require('./db');
const { t, nt, CITIES, cityName, INTERESTS } = require('./i18n');
const { icon } = require('./lib/icons');
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
  res.locals.t = (key) => t(req.lang, key);
  res.locals.nt = (stored) => nt(req.lang, stored);
  res.locals.googleEnabled = googleEnabled;
  res.locals.fmtETB = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US') + ' ETB');
  res.locals.icon = icon;
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

// Attach logged-in user + profile to request + views
app.use(async (req, res, next) => {
  req.user = null;
  req.profile = null;
  if (req.session.userId) {
    try {
      const r = await db.query('SELECT * FROM users WHERE id=$1', [req.session.userId]);
      if (r.rows.length) {
        req.user = r.rows[0];
        const p = await db.query('SELECT * FROM profiles WHERE user_id=$1', [req.user.id]);
        req.profile = p.rows[0] || null;
      } else delete req.session.userId;
    } catch (e) { return next(e); }
  }
  res.locals.user = req.user;
  res.locals.profile = req.profile;
  res.locals.unreadCount = 0;
  if (req.user) {
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

// Flash messages (simple, session-based)
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.use('/messages', require('./routes/messages'));
app.use('/premium', require('./routes/premium'));
app.use('/settings', require('./routes/settings'));
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
