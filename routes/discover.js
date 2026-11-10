// Discover / matching / onboarding / profiles.
// A match + conversation is created ONLY when both users like each other.
// Free tier: first 3 matches free; the 4th mutual like hits the paywall.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { haversineKm, fmtDistance, splitList, matchScore } = require('../lib/match');
const { notify } = require('../lib/notify');
const { processDemoAutoMatches } = require('../lib/demo-auto');
const { thumbFor, backfillProfileThumb } = require('../lib/thumbs');
const router = express.Router();

const FREE_MATCHES = 3;

const photoUpload = multer({
  storage: multer.memoryStorage(),
  // 20MB cap: phone photos are routinely 3-12MB. They are shrunk with Sharp
  // before storing (see below), so the cap is only a safety net — the old
  // 3MB cap rejected normal phone photos and bounced users back with their
  // answers lost, which looked like "data not going to database".
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});
const photosUpload = photoUpload.fields([
  { name: 'photo1', maxCount: 1 }, { name: 'photo2', maxCount: 1 }, { name: 'photo3', maxCount: 1 },
]);

function requireOnboarded(req, res, next) {
  if (!req.user) return res.redirect('/signin');
  if (!req.profile) return res.redirect('/onboarding');
  next();
}

async function matchCount(userId) {
  const r = await db.query('SELECT COUNT(*)::int AS n FROM matches WHERE user_a_id=$1 OR user_b_id=$1', [userId]);
  return r.rows[0].n;
}

// Create match + conversation for a mutual like. Returns match id or null.
// Caller enforces the paywall; this only creates when called.
async function createMatch(aId, bId) {
  const a = Math.min(aId, bId), b = Math.max(aId, bId);
  const ex = await db.query('SELECT id FROM matches WHERE user_a_id=$1 AND user_b_id=$2', [a, b]);
  if (ex.rows.length) return ex.rows[0].id;
  const m = await db.query('INSERT INTO matches(user_a_id,user_b_id) VALUES($1,$2) RETURNING id', [a, b]);
  await db.query('INSERT INTO conversations(match_id,user_a_id,user_b_id) VALUES($1,$2,$3) ON CONFLICT (match_id) DO NOTHING',
    [m.rows[0].id, a, b]);
  await db.query('UPDATE users SET free_matches_used = free_matches_used + 1 WHERE id IN ($1,$2)', [a, b]);
  return m.rows[0].id;
}

// After a user becomes premium, turn every pending mutual like into a match.
async function ensureMatchesFor(userId) {
  const r = await db.query(
    `SELECT s.to_user_id AS other_id FROM swipes s
     JOIN swipes s2 ON s2.from_user_id = s.to_user_id AND s2.to_user_id = s.from_user_id
       AND s2.kind IN ('like','super')
     WHERE s.from_user_id=$1 AND s.kind IN ('like','super')`,
    [userId]);
  const created = [];
  for (const row of r.rows) {
    const id = await createMatch(userId, row.other_id);
    if (id) created.push(id);
  }
  return created;
}

// ---- Candidates: not me, not banned, has a profile, not swiped yet,
// ---- not blocked either way, fits my looking-for + age range (and I fit theirs).
// ---- Settings prefs are REAL filters here: my age range, my preferred
// ---- religion, Verified Only (verified = email verified, or a demo
// ---- profile — demos have no email to verify, and the badge already
// ---- shows for them), and other users' Incognito (they stay hidden from
// ---- my deck unless they already liked me).
async function getCandidates(me, meProfile, opts = {}) {
  const blocked = await db.query(
    'SELECT blocked_id FROM blocks WHERE blocker_id=$1 UNION SELECT blocker_id FROM blocks WHERE blocked_id=$1',
    [me.id]);
  const blockedIds = blocked.rows.map((x) => x.blocked_id);
  // Slim columns only: v1 selected p.* for up to 200 candidates, which pulled
  // all three base64 photos per person into the Discover page (megabytes).
  // photo2/3 ride along now for the story-progress photo viewer, as
  // 360px thumbs are NOT used on the full-screen card — the full photo is
  // one image, and the card is the whole screen.
  let sql = `SELECT u.id, u.name, u.gender, u.age, u.is_premium, u.email_verified, u.is_demo,
             p.user_id, p.bio, p.city, p.country, p.latitude, p.longitude,
             p.height_cm, p.religion, p.education, p.job, p.smoking, p.drinking, p.kids,
             p.looking_for_gender, p.age_min, p.age_max, p.relationship_goal, p.interests,
             p.languages, p.photo1, p.photo1_thumb, p.photo2, p.photo2_thumb,
             p.photo3, p.photo3_thumb, p.online, p.last_active, p.created_at, p.incognito
             FROM users u JOIN profiles p ON p.user_id = u.id
             WHERE u.role='user' AND u.id <> $1 AND u.is_banned = FALSE`;
  const params = [me.id];
  let i = 2;
  if (blockedIds.length) {
    const ph = blockedIds.map(() => `$${i++}`).join(',');
    sql += ` AND u.id NOT IN (${ph})`;
    params.push(...blockedIds);
  }
  // Incognito: "only people you like can see you" — a user with incognito
  // on is invisible in decks unless they already liked the viewer.
  // (Written as u.id IN (...) rather than a correlated EXISTS, because
  // pg-mem — the local test DB — cannot resolve the outer alias inside
  // an EXISTS subquery; Postgres handles both.)
  sql += ` AND (p.incognito IS NOT TRUE OR u.id IN (SELECT from_user_id FROM swipes WHERE to_user_id = $1 AND kind IN ('like','super')))`;
  if (opts.recycled) {
    // Recycled deck: people already swiped — but NEVER anyone already
    // matched (they live in Matches now). The deck loops instead of
    // running dry; ordering below puts the least-recently-swiped first,
    // so a re-swiped profile goes to the back of the queue.
    sql += ` AND u.id NOT IN (SELECT CASE WHEN user_a_id=$1 THEN user_b_id ELSE user_a_id END FROM matches WHERE user_a_id=$1 OR user_b_id=$1)`;
  } else {
    sql += ` AND u.id NOT IN (SELECT to_user_id FROM swipes WHERE from_user_id=$1)`;
  }
  if (meProfile.looking_for_gender && meProfile.looking_for_gender !== 'any') {
    sql += ` AND u.gender = $${i++}`;
    params.push(meProfile.looking_for_gender);
  }
  if (opts.ageMin) { sql += ` AND u.age >= $${i++}`; params.push(Number(opts.ageMin)); }
  if (opts.ageMax) { sql += ` AND u.age <= $${i++}`; params.push(Number(opts.ageMax)); }
  if (opts.religion) { sql += ` AND p.religion = $${i++}`; params.push(opts.religion); }
  if (opts.verifiedOnly) { sql += ` AND (u.email_verified = TRUE OR u.is_demo = TRUE)`; }
  if (opts.onlineOnly) { sql += ` AND p.online = TRUE`; }
  sql += ' ORDER BY p.last_active DESC LIMIT 40';
  const r = await db.query(sql, params);
  const out = [];
  for (const c of r.rows) {
    // I must also fit THEIR age range
    if (me.age < (c.age_min ?? 18) || me.age > (c.age_max ?? 99)) continue;
    const dist = haversineKm(meProfile.latitude, meProfile.longitude, c.latitude, c.longitude);
    if (opts.maxKm != null && (dist == null || dist > opts.maxKm)) continue;
    out.push({
      ...c,
      thumb: thumbFor(c.photo1, c.photo1_thumb),
      // Story-progress viewer: 360px thumbs keep the page light; the
      // main <img> still shows the full first photo, and the public
      // profile page shows the full versions.
      photos: [thumbFor(c.photo1, c.photo1_thumb), thumbFor(c.photo2, c.photo2_thumb), thumbFor(c.photo3, c.photo3_thumb)].filter(Boolean),
      verified: !!(c.email_verified || c.is_demo),
      distanceKm: dist,
      distanceText: fmtDistance(dist),
      score: matchScore(
        { age: me.age, age_min: meProfile.age_min, age_max: meProfile.age_max, interests: meProfile.interests, relationship_goal: meProfile.relationship_goal, smoking: meProfile.smoking, drinking: meProfile.drinking },
        { age: c.age, age_min: c.age_min, age_max: c.age_max, interests: c.interests, relationship_goal: c.relationship_goal, smoking: c.smoking, drinking: c.drinking },
        dist),
      interestsList: splitList(c.interests),
    });
  }
  // Nearest first, then best match score — except the recycled deck,
  // which loops least-recently-swiped first so everyone cycles through
  // before anyone repeats (a re-swipe stamps created_at to now, sending
  // that profile to the back of the queue). Sorted in JS, not SQL: a
  // correlated subquery in ORDER BY works in Postgres but pg-mem (the
  // local test DB) cannot parse it.
  if (opts.recycled) {
    const sw = await db.query('SELECT to_user_id, MAX(created_at) AS last_swiped FROM swipes WHERE from_user_id=$1 GROUP BY to_user_id', [me.id]);
    const lastSwiped = new Map(sw.rows.map((r) => [r.to_user_id, new Date(r.last_swiped).getTime()]));
    out.sort((a, b) => (lastSwiped.get(a.id) ?? 0) - (lastSwiped.get(b.id) ?? 0));
  } else {
    out.sort((x, y) => {
      const dx = x.distanceKm == null ? 1e9 : x.distanceKm;
      const dy = y.distanceKm == null ? 1e9 : y.distanceKm;
      if (dx !== dy) return dx - dy;
      return y.score - x.score;
    });
  }
  // Backfill missing thumbnails in the background (fire-and-forget): older
  // profiles stored before thumbs existed serve the full photo this once.
  for (const c of out) backfillProfileThumb(c.user_id, c.photo1, c.photo1_thumb);
  return out;
}

// After a like is recorded: if the other side already liked me, it is a
// mutual like — create the match (paywall first) and go to the match
// screen. Returns the redirect target. Shared by the swipe buttons and
// the public-profile swipe buttons so all of them behave identically.
async function processLike(req, toId, targetName) {
  const mutual = await db.query(
    "SELECT kind FROM swipes WHERE from_user_id=$1 AND to_user_id=$2 AND kind IN ('like','super')",
    [toId, req.user.id]);
  if (!mutual.rows.length) return '/discover';
  const n = await matchCount(req.user.id);
  if (!req.user.is_premium && n >= FREE_MATCHES) {
    req.session.flash = { type: 'err', msg: req.res.locals.t('premiumNeeded') };
    return '/premium?blocked=1';
  }
  const matchId = await createMatch(req.user.id, toId);
  await notify(db, toId, 'match', '/match/' + matchId, 'itsAMatch', 'matchSub', [req.user.name]);
  await notify(db, req.user.id, 'match', '/match/' + matchId, 'itsAMatch', 'matchSub', [targetName]);
  return '/match/' + matchId;
}

// Best-effort demo auto-match sweep on page load. A failure here must
// never break the page the user actually asked for.
async function sweepDemoAutoMatches(req) {
  if (!req.user || req.user.role !== 'user') return;
  try { await processDemoAutoMatches(req.user); } catch (e) { console.error('[demo-auto] page sweep failed:', e.message); }
}

function photoOf(p) {
  if (!p) return null;
  // Thumbnail first (130px circle on the match screen); full photo fallback.
  return p.photo1_thumb || p.photo1 || p.photo2_thumb || p.photo2 || p.photo3_thumb || p.photo3 || null;
}

// Shared Discover data: the card, the remaining count. Used by GET
// /discover and by the instant XHR buttons, so both render exactly the
// same page. The deck is INFINITE: when the fresh cards run out, the
// already-swiped profiles loop back in (least-recently-swiped first) —
// the "caught up" state only ever appears when there are literally zero
// candidates in the whole system. Swiping is the only way to see people.
async function discoverData(req) {
  await sweepDemoAutoMatches(req);
  await db.query('UPDATE profiles SET online=TRUE, last_active=NOW() WHERE user_id=$1', [req.user.id]);
  // My Settings prefs are the filters: age range + preferred religion +
  // Verified Only. (Gender preference is applied inside getCandidates.)
  const prefs = {
    ageMin: req.profile.age_min, ageMax: req.profile.age_max,
    religion: (req.profile.pref_religion && req.profile.pref_religion !== 'Any') ? req.profile.pref_religion : null,
    verifiedOnly: !!req.profile.verified_only,
  };
  let cands = await getCandidates(req.user, req.profile, prefs);
  let recycled = false;
  if (!cands.length) {
    cands = await getCandidates(req.user, req.profile, { ...prefs, recycled: true });
    recycled = cands.length > 0;
  }
  const card = cands[0] || null;
  const n = await matchCount(req.user.id);
  return {
    card, next: cands[1] || null, remaining: cands.length,
    matchCount: n, freeLeft: Math.max(0, FREE_MATCHES - n),
    interestsList: card ? splitList(card.interests) : [],
    recycled,
  };
}

// Render the Discover page body (no layout) for instant XHR swaps: the
// client replaces #discover-root with this HTML instead of reloading the
// whole page. If rendering fails, the caller falls back to a full redirect.
function renderDiscoverBody(req, res, data) {
  return new Promise((resolve, reject) => {
    res.render('discover', {
      title: res.locals.t('discover'), ...data, photoOf, layout: false,
    }, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

// Instant-button answer: fresh Discover body as JSON. `extra` carries
// optional toast text (msg / hint). On any failure the client falls back
// to a normal form submit, so a rendering problem can never strand a tap.
async function discoverJson(req, res, extra) {
  try {
    const data = await discoverData(req);
    const html = await renderDiscoverBody(req, res, data);
    return res.json({ ok: true, html, ...(extra || {}) });
  } catch (e) {
    console.error('[instant] discover render failed:', e.message);
    return res.redirect('/discover');
  }
}

const isXhr = (req) => !!req.xhr;

// ---- Onboarding questionnaire ----
const ONBOARD_FIELDS = ['bio', 'city', 'country', 'latitude', 'longitude', 'height_cm', 'religion',
  'education', 'job', 'smoking', 'drinking', 'kids', 'looking_for_gender', 'age_min', 'age_max',
  'relationship_goal', 'interests', 'languages', 'zodiac', 'birth_place'];

router.get('/onboarding', requireAuth, async (req, res) => {
  if (req.profile) return res.redirect('/discover');
  res.render('onboarding', { title: res.locals.t('onboardingTitle'), profile: null, form: req.session.onboardAttempt || {} });
});

router.post('/onboarding', requireAuth, (req, res, next) => {
  photosUpload(req, res, (err) => {
    if (err) {
      // Keep the typed answers so the user does NOT lose everything they
      // typed (v1 dropped them here — that is what "data not going to
      // database" felt like). Multer only parses files, not fields, on
      // error — so there is nothing to keep; the message says so plainly.
      req.session.flash = {
        type: 'err',
        msg: err.code === 'LIMIT_FILE_SIZE'
          ? 'That photo is too big (over 20MB). Please pick a smaller photo — photos are shrunk automatically before saving.'
          : err.message,
      };
      return res.redirect('/onboarding');
    }
    next();
  });
}, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const b = req.body;
    const { processPhoto } = require('../lib/photos');
    const interests = Array.isArray(b.interests) ? b.interests.join(',') : (b.interests || '');
    const lat = b.latitude ? parseFloat(b.latitude) : null;
    const lng = b.longitude ? parseFloat(b.longitude) : null;
    const vals = {
      bio: (b.bio || '').trim().slice(0, 500) || null,
      city: (b.city || '').trim() || null,
      country: (b.country || '').trim() || 'Ethiopia',
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
      height_cm: b.height_cm ? parseInt(b.height_cm, 10) : null,
      religion: (b.religion || '').trim() || null,
      education: (b.education || '').trim() || null,
      job: (b.job || '').trim() || null,
      smoking: ['never', 'sometimes', 'often'].includes(b.smoking) ? b.smoking : null,
      drinking: ['never', 'sometimes', 'often'].includes(b.drinking) ? b.drinking : null,
      kids: ['none', 'have', 'want', 'dont_want'].includes(b.kids) ? b.kids : null,
      looking_for_gender: ['female', 'male', 'any'].includes(b.looking_for_gender) ? b.looking_for_gender : 'any',
      age_min: Math.max(18, parseInt(b.age_min, 10) || 18),
      age_max: Math.min(99, parseInt(b.age_max, 10) || 99),
      relationship_goal: ['serious', 'casual', 'friendship', 'marriage'].includes(b.relationship_goal) ? b.relationship_goal : null,
      interests,
      languages: (b.languages || '').trim() || 'Amharic, English',
      zodiac: ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'].includes(b.zodiac) ? b.zodiac : null,
      birth_place: (b.birth_place || '').trim().slice(0, 100) || null,
    };
    if (!vals.city) {
      req.session.flash = { type: 'err', msg: t('fillAll') };
      req.session.onboardAttempt = b;
      return res.redirect('/onboarding');
    }
    // Shrink photos before storing: a 10MB phone photo becomes ~60-150KB.
    // Without this the INSERT carried megabytes of base64 and Discover pages
    // did too. On failure, show the real reason instead of a silent bounce.
    // A 360px thumbnail is stored alongside each photo and used in cards,
    // grids and avatars so list pages don't re-download the full photo.
    const { makeThumb } = require('../lib/photos');
    const photoPair = async (field) => {
      const f = req.files && req.files[field] && req.files[field][0];
      if (!f) return [null, null];
      const full = await processPhoto(f.buffer, f.mimetype);
      const thumb = (await makeThumb(f.buffer, f.mimetype)) || full;
      return [full, thumb];
    };
    try {
      [vals.photo1, vals.photo1_thumb] = await photoPair('photo1');
      [vals.photo2, vals.photo2_thumb] = await photoPair('photo2');
      [vals.photo3, vals.photo3_thumb] = await photoPair('photo3');
    } catch (e) {
      req.session.flash = { type: 'err', msg: e.message };
      req.session.onboardAttempt = b;
      return res.redirect('/onboarding');
    }
    if (!vals.photo1 && !req.profile) {
      req.session.flash = { type: 'err', msg: t('fillAll') };
      req.session.onboardAttempt = b;
      return res.redirect('/onboarding');
    }
    const cols = Object.keys(vals);
    const existing = await db.query('SELECT user_id FROM profiles WHERE user_id=$1', [req.user.id]);
    if (!existing.rows.length) {
      const ph = cols.map((_, idx) => `$${idx + 2}`).join(',');
      await db.query(`INSERT INTO profiles(user_id,${cols.join(',')}) VALUES($1,${ph})`, [req.user.id, ...cols.map((c) => vals[c])]);
    } else {
      const sets = cols.map((c, idx) => `${c}=$${idx + 2}`).join(',');
      // Keep an existing photo (and its thumbnail) when no new file was uploaded
      const keep = {};
      for (const c of ['photo1', 'photo2', 'photo3']) {
        if (!vals[c]) { keep[c] = true; keep[c + '_thumb'] = true; }
      }
      const setCols = cols.filter((c) => !keep[c]);
      const setSql = setCols.map((c, idx) => `${c}=$${idx + 2}`).join(',');
      await db.query(`UPDATE profiles SET ${setSql}, online=TRUE, last_active=NOW() WHERE user_id=$1`,
        [req.user.id, ...setCols.map((c) => vals[c])]);
    }
    delete req.session.onboardAttempt;
    req.session.flash = { type: 'ok', msg: t('onboardingDone') };
    res.redirect('/discover');
  } catch (e) { next(e); }
});

// ---- My profile + edit ----
router.get('/profile', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const n = await matchCount(req.user.id);
    res.render('my-profile', {
      title: req.user.name, me: req.user, p: req.profile, matchCount: n,
      freeLeft: Math.max(0, FREE_MATCHES - n),
      interestsList: splitList(req.profile.interests),
    });
  } catch (e) { next(e); }
});

// ---- My Profile photos: drag-to-reorder / tap-to-replace / remove ----
// The grid sends slot numbers 1-3. Reorder permutes the three photo
// columns (photo + thumb together) in one UPDATE; remove compacts the
// remaining photos up so photo1 is always the main photo.
router.post('/profile/photos/reorder', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    let order = req.body.order;
    if (typeof order === 'string') order = order.split(',');
    order = (Array.isArray(order) ? order : []).map((x) => Number(x)).filter((x) => [1, 2, 3].includes(x));
    if (order.length !== 3 || new Set(order).size !== 3) {
      return res.status(400).json({ ok: false, msg: 'Order must list slots 1, 2 and 3.' });
    }
    const p = req.profile;
    const cols = ['photo1', 'photo2', 'photo3'];
    const thumbs = ['photo1_thumb', 'photo2_thumb', 'photo3_thumb'];
    const vals = {};
    order.forEach((from, i) => {
      vals[cols[i]] = p[cols[from - 1]];
      vals[thumbs[i]] = p[thumbs[from - 1]];
    });
    await db.query('UPDATE profiles SET photo1=$1, photo1_thumb=$2, photo2=$3, photo2_thumb=$4, photo3=$5, photo3_thumb=$6 WHERE user_id=$7',
      [vals.photo1, vals.photo1_thumb, vals.photo2, vals.photo2_thumb, vals.photo3, vals.photo3_thumb, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/profile/photos/replace', requireAuth, requireOnboarded, (req, res, next) => {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, msg: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    const slot = Number(req.body.slot);
    if (![1, 2, 3].includes(slot)) return res.status(400).json({ ok: false, msg: 'Bad slot' });
    if (!req.file || !req.file.buffer) return res.status(400).json({ ok: false, msg: 'No photo chosen' });
    const { processPhoto, makeThumb } = require('../lib/photos');
    const full = await processPhoto(req.file.buffer, req.file.mimetype);
    const thumb = (await makeThumb(req.file.buffer, req.file.mimetype)) || full;
    const col = 'photo' + slot, tcol = col + '_thumb';
    await db.query(`UPDATE profiles SET ${col}=$1, ${tcol}=$2, online=TRUE, last_active=NOW() WHERE user_id=$3`,
      [full, thumb, req.user.id]);
    res.json({ ok: true, thumb });
  } catch (e) { next(e); }
});

router.post('/profile/photos/remove', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const slot = Number(req.body.slot);
    if (![1, 2, 3].includes(slot)) return res.status(400).json({ ok: false, msg: 'Bad slot' });
    const p = req.profile;
    const cols = ['photo1', 'photo2', 'photo3'];
    const thumbs = ['photo1_thumb', 'photo2_thumb', 'photo3_thumb'];
    const photos = cols.map((c, i) => [p[c], p[thumbs[i]]]);
    photos.splice(slot - 1, 1);
    photos.push([null, null]);
    await db.query('UPDATE profiles SET photo1=$1, photo1_thumb=$2, photo2=$3, photo2_thumb=$4, photo3=$5, photo3_thumb=$6 WHERE user_id=$7',
      [...photos.flat(), req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/profile/edit', requireAuth, (req, res) => {
  // Same questionnaire as onboarding; reachable with or without a profile
  // (the global gate allows it), so a new user is never stuck in a loop.
  res.render('onboarding', { title: res.locals.t('editProfile'), profile: req.profile, form: {} });
});

// ---- Discover: one card at a time, nearest + best match first ----
// The deck loops forever (see discoverData): the "caught up" state only
// appears when there are literally no candidates at all in the system.
router.get('/discover', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const data = await discoverData(req);
    res.render('discover', {
      title: res.locals.t('discover'), ...data, photoOf, bodyClass: 'discover-page',
    });
  } catch (e) { next(e); }
});

// Record a like/super (shared by the swipe buttons and the message
// button on a card). Returns { dest, hint, alreadyLiked } — dest is
// '/discover' when there is no mutual like yet, '/match/:id' on a new
// match, or '/premium?blocked=1' when the mutual like hit the paywall
// (the like itself IS saved, so Premium approval still creates the
// match later via ensureMatchesFor).
async function recordLike(req, toId, target, kind) {
  const t = req.res.locals.t;
  const already = await db.query('SELECT kind FROM swipes WHERE from_user_id=$1 AND to_user_id=$2', [req.user.id, toId]);
  const prevKind = already.rows.length ? already.rows[0].kind : null;
  if (prevKind === 'like' || prevKind === 'super') {
    // Re-liking someone already liked: a strict no-op. Never a second
    // match, never another free match — the caller re-queues the card.
    return { dest: '/discover', hint: null, alreadyLiked: true };
  }
  if (prevKind === 'pass') {
    // Pass -> like/super upgrade: change the stored swipe, then run the
    // normal like flow below (a NEW match from it still counts as a
    // free match, exactly like a first-time like).
    await db.query('UPDATE swipes SET kind=$3, created_at=NOW() WHERE from_user_id=$1 AND to_user_id=$2', [req.user.id, toId, kind]);
  } else {
    await db.query('INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,$3) ON CONFLICT (from_user_id,to_user_id) DO NOTHING',
      [req.user.id, toId, kind]);
  }
  // Demo profiles like back automatically after 60s (see lib/demo-auto);
  // tell the tester so the wait is expected, not a mystery. Only when
  // the demo has NOT already liked back (those match instantly).
  let hint = null;
  if (target.is_demo) {
    const alreadyLikedBack = await db.query(
      "SELECT 1 FROM swipes WHERE from_user_id=$1 AND to_user_id=$2 AND kind IN ('like','super')",
      [toId, req.user.id]);
    if (!alreadyLikedBack.rows.length) hint = t('demoReplyHint');
  }
  const dest = await processLike(req, toId, target.name);
  return { dest, hint, alreadyLiked: false };
}

// Message button on a Discover card / public profile: if already matched,
// open the chat; otherwise like first — if that like completes a match,
// go straight to the chat; if not, the like is saved and the next card
// shows (the reference app's message button is a like-first action).
router.post('/discover/message', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const toId = Number(req.body.to);
    if (!toId || toId === req.user.id) return isXhr(req) ? discoverJson(req, res) : res.redirect('/discover');
    const target = await db.query('SELECT id, name, is_demo FROM users WHERE id=$1 AND role=$2 AND is_banned=FALSE', [toId, 'user']);
    if (!target.rows.length) return isXhr(req) ? discoverJson(req, res) : res.redirect('/discover');
    const openChat = async () => {
      const m = await db.query('SELECT c.id AS conv_id FROM matches m LEFT JOIN conversations c ON c.match_id=m.id WHERE (m.user_a_id=$1 AND m.user_b_id=$2) OR (m.user_a_id=$2 AND m.user_b_id=$1)', [req.user.id, toId]);
      return m.rows.length && m.rows[0].conv_id ? '/messages/' + m.rows[0].conv_id : null;
    };
    let chatUrl = await openChat();
    if (chatUrl) return isXhr(req) ? res.json({ ok: true, redirect: chatUrl }) : res.redirect(chatUrl);
    const { dest, hint } = await recordLike(req, toId, target.rows[0], 'like');
    if (dest === '/premium?blocked=1') {
      // Paywall: the like is saved, the match waits for Premium.
      // XHR: advance to the next card AND open the premium sheet on top.
      if (isXhr(req)) return discoverJson(req, res, { sheet: 'premium', hint });
      req.session.flash = { type: 'err', msg: t('premiumNeeded') };
      return res.redirect(dest);
    }
    if (dest !== '/discover') {
      chatUrl = await openChat();
      const url = chatUrl || dest;
      return isXhr(req) ? res.json({ ok: true, redirect: url, hint }) : res.redirect(url);
    }
    if (!isXhr(req) && hint) req.session.flash = { type: 'ok', msg: hint };
    return isXhr(req) ? discoverJson(req, res, hint ? { hint } : null) : res.redirect('/discover');
  } catch (e) { next(e); }
});

// ---- Swipe: like / pass / super-like. Mutual like => match (or paywall on 4th). ----
router.post('/discover/swipe', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const kind = ['like', 'pass', 'super'].includes(req.body.kind) ? req.body.kind : 'pass';
    const toId = Number(req.body.to);
    // Instant buttons (XHR): answer JSON with a fresh Discover body instead
    // of a full redirect — the card swaps in place. Anything unexpected
    // falls back to the old redirect flow on the client.
    if (!toId || toId === req.user.id) return isXhr(req) ? discoverJson(req, res) : res.redirect('/discover');
    const target = await db.query('SELECT id, name, is_demo FROM users WHERE id=$1 AND role=$2 AND is_banned=FALSE', [toId, 'user']);
    if (!target.rows.length) return isXhr(req) ? discoverJson(req, res) : res.redirect('/discover');
    if (kind === 'pass') {
      const already = await db.query('SELECT kind FROM swipes WHERE from_user_id=$1 AND to_user_id=$2', [req.user.id, toId]);
      const prevKind = already.rows.length ? already.rows[0].kind : null;
      if (prevKind === 'like' || prevKind === 'super') {
        // Passing someone already liked: the like stays — just stamp the
        // swipe as fresh so the profile re-queues at the back of the
        // recycled deck.
        await db.query('UPDATE swipes SET created_at=NOW() WHERE from_user_id=$1 AND to_user_id=$2', [req.user.id, toId]);
      } else if (prevKind === 'pass') {
        // Re-pass: re-queue at the back of the deck, nothing else.
        await db.query('UPDATE swipes SET created_at=NOW() WHERE from_user_id=$1 AND to_user_id=$2', [req.user.id, toId]);
        req.session.lastPass = toId; // rewind still brings this card back
      } else {
        await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'pass') ON CONFLICT (from_user_id,to_user_id) DO NOTHING",
          [req.user.id, toId]);
        req.session.lastPass = toId; // rewind target (once)
      }
      return isXhr(req) ? discoverJson(req, res) : res.redirect('/discover');
    }
    const { dest, hint, alreadyLiked } = await recordLike(req, toId, target.rows[0], kind);
    if (alreadyLiked) {
      // Re-like: strict no-op, just re-queue the card at the back.
      await db.query('UPDATE swipes SET created_at=NOW() WHERE from_user_id=$1 AND to_user_id=$2', [req.user.id, toId]);
      return isXhr(req) ? discoverJson(req, res) : res.redirect('/discover');
    }
    // XHR: the hint rides in the JSON (a session flash would only appear
    // on the next full page load); plain forms keep the flash.
    if (!isXhr(req) && hint) req.session.flash = { type: 'ok', msg: hint };
    if (dest === '/premium?blocked=1') {
      // Paywall: the like is saved, but the match waits for Premium.
      // XHR: advance to the next card AND open the premium sheet on top
      // (the reference "Need More Points" sheet, with our real numbers).
      // Plain forms navigate to the Premium page.
      if (isXhr(req)) return discoverJson(req, res, { sheet: 'premium', hint });
      req.session.flash = { type: 'err', msg: t('premiumNeeded') };
      return res.redirect(dest);
    }
    if (dest !== '/discover') {
      // Match screen: a real navigation either way.
      return isXhr(req) ? res.json({ ok: true, redirect: dest, hint }) : res.redirect(dest);
    }
    return isXhr(req) ? discoverJson(req, res, hint ? { hint } : null) : res.redirect(dest);
  } catch (e) { next(e); }
});

// Rewind once: bring back the last passed profile
router.post('/discover/rewind', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const last = req.session.lastPass;
    if (!last) {
      if (isXhr(req)) return res.json({ ok: false, msg: t('noRewind') });
      req.session.flash = { type: 'err', msg: t('noRewind') };
      return res.redirect('/discover');
    }
    await db.query("DELETE FROM swipes WHERE from_user_id=$1 AND to_user_id=$2 AND kind='pass'", [req.user.id, last]);
    delete req.session.lastPass;
    if (isXhr(req)) return discoverJson(req, res, { msg: t('rewound') });
    req.session.flash = { type: 'ok', msg: t('rewound') };
    res.redirect('/discover');
  } catch (e) { next(e); }
});

// "Show profiles again": clear ONLY my passes so swiped-past profiles come
// back. Likes, super-likes and matches are never touched.
router.post('/discover/reset-passes', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    await db.query("DELETE FROM swipes WHERE from_user_id=$1 AND kind='pass'", [req.user.id]);
    delete req.session.lastPass;
    if (isXhr(req)) return discoverJson(req, res, { msg: res.locals.t('passesCleared') });
    req.session.flash = { type: 'ok', msg: res.locals.t('passesCleared') };
    res.redirect('/discover');
  } catch (e) { next(e); }
});

// ---- Match screen ----
router.get('/match/:id', requireAuth, async (req, res, next) => {
  try {
    const m = await db.query('SELECT * FROM matches WHERE id=$1 AND (user_a_id=$2 OR user_b_id=$2)',
      [req.params.id, req.user.id]);
    if (!m.rows.length) return res.status(404).render('404');
    const otherId = m.rows[0].user_a_id === req.user.id ? m.rows[0].user_b_id : m.rows[0].user_a_id;
    const o = await db.query(
      'SELECT u.id, u.name, u.age, p.photo1, p.photo1_thumb FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1', [otherId]);
    if (!o.rows.length) return res.status(404).render('404');
    o.rows[0].thumb = thumbFor(o.rows[0].photo1, o.rows[0].photo1_thumb);
    backfillProfileThumb(otherId, o.rows[0].photo1, o.rows[0].photo1_thumb);
    const conv = await db.query('SELECT id FROM conversations WHERE match_id=$1', [m.rows[0].id]);
    res.render('match', {
      title: res.locals.t('itsAMatch'), match: m.rows[0], other: o.rows[0],
      convId: conv.rows.length ? conv.rows[0].id : null,
      myPhoto: req.profile ? photoOf(req.profile) : null,
    });
  } catch (e) { next(e); }
});

// ---- Explore is gone: the app is swipe-only now. Any old link or
// bookmark to /explore lands on the Discover deck instead of a dead page.
router.get('/explore', (req, res) => res.redirect('/discover'));

// ---- Matches live inside Messages now (the reference has no separate
// ---- Matches list — matched people are reached from their chats).
// ---- Old /matches links land on the inbox instead of a dead page.
router.get('/matches', requireAuth, requireOnboarded, (req, res) => res.redirect('/messages'));

// ---- Likes: people who liked me / people I liked (heart tab) ----
router.get('/likes', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    await sweepDemoAutoMatches(req);
    const tab = req.query.tab === 'sent' ? 'sent' : 'received';
    const blocked = await db.query(
      'SELECT blocked_id FROM blocks WHERE blocker_id=$1 UNION SELECT blocker_id FROM blocks WHERE blocked_id=$1',
      [req.user.id]);
    const blockedIds = blocked.rows.map((x) => x.blocked_id);
    const notBlocked = blockedIds.length
      ? ` AND u.id NOT IN (${blockedIds.map((_, i) => '$' + (i + 2)).join(',')})`
      : '';
    const params = [req.user.id, ...blockedIds];
    const rows = tab === 'received'
      ? (await db.query(
        `SELECT u.id, u.name, u.age, u.email_verified, u.is_demo,
                p.photo1, p.photo1_thumb, p.city, p.country, p.latitude, p.longitude, p.online,
                s.created_at AS liked_at
         FROM swipes s JOIN users u ON u.id = s.from_user_id JOIN profiles p ON p.user_id = u.id
         WHERE s.to_user_id = $1 AND s.kind IN ('like','super') AND u.role='user' AND u.is_banned=FALSE${notBlocked}
         ORDER BY s.created_at DESC`, params)).rows
      : (await db.query(
        `SELECT u.id, u.name, u.age, u.email_verified, u.is_demo,
                p.photo1, p.photo1_thumb, p.city, p.country, p.latitude, p.longitude, p.online,
                s.created_at AS liked_at
         FROM swipes s JOIN users u ON u.id = s.to_user_id JOIN profiles p ON p.user_id = u.id
         WHERE s.from_user_id = $1 AND s.kind IN ('like','super') AND u.role='user' AND u.is_banned=FALSE${notBlocked}
         ORDER BY s.created_at DESC`, params)).rows;
    const items = rows.map((row) => ({
      ...row,
      thumb: thumbFor(row.photo1, row.photo1_thumb),
      verified: !!(row.email_verified || row.is_demo),
      distanceText: fmtDistance(haversineKm(req.profile.latitude, req.profile.longitude, row.latitude, row.longitude)),
    }));
    for (const it of items) backfillProfileThumb(it.id, it.photo1, it.photo1_thumb);
    // Fragment swap: the Likes tabs switch without a full page reload
    // (same pattern the old Explore tabs used). ?fragment=1 answers with
    // just the grid HTML; anything else renders the whole page.
    if (req.query.fragment === '1') {
      return res.render('likes-grid', { items, tab, layout: false }, (err, html) => {
        if (err) return next(err);
        res.send(html);
      });
    }
    res.render('likes', { title: 'Likes', items, tab });
  } catch (e) { next(e); }
});

// ---- Public profile ----
router.get('/u/:id', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Preview Profile (from My Profile): see your own page exactly as
    // others see it — same template, no swipe buttons, no report/block.
    if (id === req.user.id) {
      if (req.query.preview !== '1') return res.redirect('/profile');
      const other = {
        ...req.profile, id: req.user.id, name: req.user.name, gender: req.user.gender,
        age: req.user.age, is_premium: req.user.is_premium,
        email_verified: req.user.email_verified, is_demo: req.user.is_demo,
      };
      return res.render('profile-public', {
        title: other.name, other, distanceText: null, score: null,
        interestsList: splitList(other.interests), swiped: null,
        matched: null, convId: null, isBlocked: false,
        verified: !!(other.email_verified || other.is_demo), preview: true,
      });
    }
    const r = await db.query(
      `SELECT u.id, u.name, u.gender, u.age, u.is_premium, u.email_verified, u.is_demo, p.*
       FROM users u JOIN profiles p ON p.user_id=u.id
       WHERE u.id=$1 AND u.role='user' AND u.is_banned=FALSE`, [id]);
    if (!r.rows.length) return res.status(404).render('404');
    const other = r.rows[0];
    const dist = haversineKm(req.profile.latitude, req.profile.longitude, other.latitude, other.longitude);
    const score = matchScore(
      { age: req.user.age, age_min: req.profile.age_min, age_max: req.profile.age_max, interests: req.profile.interests, relationship_goal: req.profile.relationship_goal, smoking: req.profile.smoking, drinking: req.profile.drinking },
      { age: other.age, age_min: other.age_min, age_max: other.age_max, interests: other.interests, relationship_goal: other.relationship_goal, smoking: other.smoking, drinking: other.drinking },
      dist);
    const sw = await db.query('SELECT kind FROM swipes WHERE from_user_id=$1 AND to_user_id=$2', [req.user.id, id]);
    const matched = await db.query('SELECT m.id, c.id AS conv_id FROM matches m LEFT JOIN conversations c ON c.match_id=m.id WHERE (m.user_a_id=$1 AND m.user_b_id=$2) OR (m.user_a_id=$2 AND m.user_b_id=$1)',
      [req.user.id, id]);
    const blocked = await db.query('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [req.user.id, id]);
    res.render('profile-public', {
      title: other.name, other, distanceText: fmtDistance(dist), score,
      interestsList: splitList(other.interests), swiped: sw.rows[0] || null,
      matched: matched.rows[0] || null, convId: matched.rows[0] ? matched.rows[0].conv_id : null,
      isBlocked: blocked.rows.length > 0,
      verified: !!(other.email_verified || other.is_demo), preview: false,
    });
  } catch (e) { next(e); }
});

// Report a user
router.post('/u/:id/report', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const id = Number(req.params.id);
    const reason = (req.body.reason || '').trim().slice(0, 500) || 'No reason given';
    if (id === req.user.id) return res.redirect('/discover');
    const ex = await db.query("SELECT id FROM reports WHERE reporter_user_id=$1 AND reported_user_id=$2 AND status='pending'",
      [req.user.id, id]);
    if (ex.rows.length) {
      if (isXhr(req)) return res.json({ ok: false, msg: t('alreadyReported') });
      req.session.flash = { type: 'err', msg: t('alreadyReported') };
      return res.redirect('/u/' + id);
    }
    await db.query('INSERT INTO reports(reporter_user_id,reported_user_id,reason) VALUES($1,$2,$3)',
      [req.user.id, id, reason]);
    // Instant report: no reload, the client just shows a toast.
    if (isXhr(req)) return res.json({ ok: true, msg: t('reported') });
    req.session.flash = { type: 'ok', msg: t('reported') };
    res.redirect('/u/' + id);
  } catch (e) { next(e); }
});

// Block a user (also removes any match + hides them from Discover)
router.post('/u/:id/block', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const id = Number(req.params.id);
    if (id === req.user.id) return res.redirect('/discover');
    await db.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.id, id]);
    await db.query('DELETE FROM matches WHERE (user_a_id=$1 AND user_b_id=$2) OR (user_a_id=$2 AND user_b_id=$1)',
      [req.user.id, id]);
    req.session.flash = { type: 'ok', msg: t('blocked') };
    res.redirect('/discover');
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.ensureMatchesFor = ensureMatchesFor;
module.exports.createMatch = createMatch;
module.exports.getCandidates = getCandidates;
module.exports.discoverData = discoverData;
module.exports.matchCount = matchCount;
