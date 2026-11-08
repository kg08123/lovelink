// Discover / matching / onboarding / profiles.
// A match + conversation is created ONLY when both users like each other.
// Free tier: first 3 matches free; the 4th mutual like hits the paywall.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { haversineKm, fmtDistance, splitList, matchScore } = require('../lib/match');
const { notify } = require('../lib/notify');
const router = express.Router();

const FREE_MATCHES = 3;

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
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
async function getCandidates(me, meProfile, opts = {}) {
  const blocked = await db.query(
    'SELECT blocked_id FROM blocks WHERE blocker_id=$1 UNION SELECT blocker_id FROM blocks WHERE blocked_id=$1',
    [me.id]);
  const blockedIds = blocked.rows.map((x) => x.blocked_id);
  let sql = `SELECT u.id, u.name, u.gender, u.age, u.is_premium, p.*
             FROM users u JOIN profiles p ON p.user_id = u.id
             WHERE u.role='user' AND u.id <> $1 AND u.is_banned = FALSE`;
  const params = [me.id];
  let i = 2;
  if (blockedIds.length) {
    const ph = blockedIds.map(() => `$${i++}`).join(',');
    sql += ` AND u.id NOT IN (${ph})`;
    params.push(...blockedIds);
  }
  if (!opts.includeSwiped) {
    sql += ` AND u.id NOT IN (SELECT to_user_id FROM swipes WHERE from_user_id=$1)`;
  }
  if (meProfile.looking_for_gender && meProfile.looking_for_gender !== 'any') {
    sql += ` AND u.gender = $${i++}`;
    params.push(meProfile.looking_for_gender);
  }
  if (opts.ageMin) { sql += ` AND u.age >= $${i++}`; params.push(Number(opts.ageMin)); }
  if (opts.ageMax) { sql += ` AND u.age <= $${i++}`; params.push(Number(opts.ageMax)); }
  if (opts.onlineOnly) { sql += ` AND p.online = TRUE`; }
  sql += ' ORDER BY p.last_active DESC LIMIT 200';
  const r = await db.query(sql, params);
  const out = [];
  for (const c of r.rows) {
    // I must also fit THEIR age range
    if (me.age < (c.age_min ?? 18) || me.age > (c.age_max ?? 99)) continue;
    const dist = haversineKm(meProfile.latitude, meProfile.longitude, c.latitude, c.longitude);
    if (opts.maxKm != null && (dist == null || dist > opts.maxKm)) continue;
    out.push({
      ...c,
      distanceKm: dist,
      distanceText: fmtDistance(dist),
      score: matchScore(
        { age: me.age, age_min: meProfile.age_min, age_max: meProfile.age_max, interests: meProfile.interests, relationship_goal: meProfile.relationship_goal, smoking: meProfile.smoking, drinking: meProfile.drinking },
        { age: c.age, age_min: c.age_min, age_max: c.age_max, interests: c.interests, relationship_goal: c.relationship_goal, smoking: c.smoking, drinking: c.drinking },
        dist),
      interestsList: splitList(c.interests),
    });
  }
  // Nearest first, then best match score
  out.sort((x, y) => {
    const dx = x.distanceKm == null ? 1e9 : x.distanceKm;
    const dy = y.distanceKm == null ? 1e9 : y.distanceKm;
    if (dx !== dy) return dx - dy;
    return y.score - x.score;
  });
  return out;
}

function photoOf(p) {
  return p.photo1 || p.photo2 || p.photo3 || null;
}

// ---- Onboarding questionnaire ----
const ONBOARD_FIELDS = ['bio', 'city', 'country', 'latitude', 'longitude', 'height_cm', 'religion',
  'education', 'job', 'smoking', 'drinking', 'kids', 'looking_for_gender', 'age_min', 'age_max',
  'relationship_goal', 'interests', 'languages'];

router.get('/onboarding', requireAuth, async (req, res) => {
  if (req.profile) return res.redirect('/discover');
  res.render('onboarding', { title: res.locals.t('onboardingTitle'), profile: null, form: req.session.onboardAttempt || {} });
});

router.post('/onboarding', requireAuth, (req, res, next) => {
  photosUpload(req, res, (err) => {
    if (err) {
      req.session.flash = { type: 'err', msg: err.message };
      return res.redirect('/onboarding');
    }
    next();
  });
}, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const b = req.body;
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
    };
    if (!vals.city) {
      req.session.flash = { type: 'err', msg: t('fillAll') };
      req.session.onboardAttempt = b;
      return res.redirect('/onboarding');
    }
    const photo = (field) => {
      const f = req.files && req.files[field] && req.files[field][0];
      return f ? 'data:' + f.mimetype + ';base64,' + f.buffer.toString('base64') : null;
    };
    vals.photo1 = photo('photo1');
    vals.photo2 = photo('photo2');
    vals.photo3 = photo('photo3');
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
      // Keep an existing photo when no new file was uploaded
      const keep = {};
      for (const c of ['photo1', 'photo2', 'photo3']) if (!vals[c]) keep[c] = true;
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
    res.render('my-profile', { title: req.user.name, me: req.user, p: req.profile, matchCount: n, interestsList: splitList(req.profile.interests) });
  } catch (e) { next(e); }
});

router.get('/profile/edit', requireAuth, requireOnboarded, (req, res) => {
  res.render('onboarding', { title: res.locals.t('editProfile'), profile: req.profile, form: {} });
});

// ---- Discover: one card at a time, nearest + best match first ----
router.get('/discover', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    await db.query('UPDATE profiles SET online=TRUE, last_active=NOW() WHERE user_id=$1', [req.user.id]);
    const cands = await getCandidates(req.user, req.profile);
    const card = cands[0] || null;
    const n = await matchCount(req.user.id);
    res.render('discover', {
      title: res.locals.t('discover'), card, remaining: cands.length,
      matchCount: n, freeLeft: Math.max(0, FREE_MATCHES - n),
      photoOf, interestsList: card ? splitList(card.interests) : [],
    });
  } catch (e) { next(e); }
});

// ---- Swipe: like / pass / super-like. Mutual like => match (or paywall on 4th). ----
router.post('/discover/swipe', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const kind = ['like', 'pass', 'super'].includes(req.body.kind) ? req.body.kind : 'pass';
    const toId = Number(req.body.to);
    if (!toId || toId === req.user.id) return res.redirect('/discover');
    const target = await db.query('SELECT id, name FROM users WHERE id=$1 AND role=$2 AND is_banned=FALSE', [toId, 'user']);
    if (!target.rows.length) return res.redirect('/discover');
    const already = await db.query('SELECT kind FROM swipes WHERE from_user_id=$1 AND to_user_id=$2', [req.user.id, toId]);
    if (already.rows.length) return res.redirect('/discover');

    await db.query('INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,$3) ON CONFLICT (from_user_id,to_user_id) DO NOTHING',
      [req.user.id, toId, kind]);
    if (kind === 'pass') {
      req.session.lastPass = toId; // rewind target (once)
      return res.redirect('/discover');
    }
    // Did they already like me?
    const mutual = await db.query(
      "SELECT kind FROM swipes WHERE from_user_id=$1 AND to_user_id=$2 AND kind IN ('like','super')",
      [toId, req.user.id]);
    if (!mutual.rows.length) return res.redirect('/discover');

    // Mutual! Paywall: 4th match needs Premium (server-side, never client-only).
    const n = await matchCount(req.user.id);
    if (!req.user.is_premium && n >= FREE_MATCHES) {
      req.session.flash = { type: 'err', msg: t('premiumNeeded') };
      return res.redirect('/premium?blocked=1');
    }
    const matchId = await createMatch(req.user.id, toId);
    await notify(db, toId, 'match', '/match/' + matchId, 'itsAMatch', 'matchSub', [req.user.name]);
    await notify(db, req.user.id, 'match', '/match/' + matchId, 'itsAMatch', 'matchSub', [target.rows[0].name]);
    res.redirect('/match/' + matchId);
  } catch (e) { next(e); }
});

// Rewind once: bring back the last passed profile
router.post('/discover/rewind', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const last = req.session.lastPass;
    if (!last) {
      req.session.flash = { type: 'err', msg: t('noRewind') };
      return res.redirect('/discover');
    }
    await db.query("DELETE FROM swipes WHERE from_user_id=$1 AND to_user_id=$2 AND kind='pass'", [req.user.id, last]);
    delete req.session.lastPass;
    req.session.flash = { type: 'ok', msg: t('rewound') };
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
      'SELECT u.id, u.name, u.age, p.photo1 FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1', [otherId]);
    if (!o.rows.length) return res.status(404).render('404');
    const conv = await db.query('SELECT id FROM conversations WHERE match_id=$1', [m.rows[0].id]);
    res.render('match', {
      title: res.locals.t('itsAMatch'), match: m.rows[0], other: o.rows[0],
      convId: conv.rows.length ? conv.rows[0].id : null,
      myPhoto: req.profile ? photoOf(req.profile) : null,
    });
  } catch (e) { next(e); }
});

// ---- Explore grid: nearby / online / new, with filters ----
router.get('/explore', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const tab = ['nearby', 'online', 'new'].includes(req.query.tab) ? req.query.tab : 'nearby';
    const f = {
      tab,
      ageMin: req.query.age_min ? Number(req.query.age_min) : null,
      ageMax: req.query.age_max ? Number(req.query.age_max) : null,
      maxKm: req.query.max_km ? Number(req.query.max_km) : null,
      onlineOnly: tab === 'online' || req.query.online === '1',
    };
    let cands = await getCandidates(req.user, req.profile, { includeSwiped: true, ...f });
    if (tab === 'new') cands.sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const PER = 8;
    const total = cands.length;
    const totalPages = Math.max(1, Math.ceil(total / PER));
    const safePage = Math.min(page, totalPages);
    const pageItems = cands.slice((safePage - 1) * PER, safePage * PER);
    res.render('explore', { title: res.locals.t('explore'), items: pageItems, f, total, page: safePage, totalPages, photoOf });
  } catch (e) { next(e); }
});

// ---- Matches list ----
router.get('/matches', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT m.id, m.created_at,
              CASE WHEN m.user_a_id=$1 THEN m.user_b_id ELSE m.user_a_id END AS other_id,
              u.name AS other_name, u.age AS other_age, p.photo1, p.city, p.latitude, p.longitude,
              c.id AS conv_id
       FROM matches m
       JOIN users u ON u.id = (CASE WHEN m.user_a_id=$1 THEN m.user_b_id ELSE m.user_a_id END)
       JOIN profiles p ON p.user_id = u.id
       LEFT JOIN conversations c ON c.match_id = m.id
       WHERE m.user_a_id=$1 OR m.user_b_id=$1
       ORDER BY m.created_at DESC`,
      [req.user.id]);
    for (const row of r.rows) {
      row.distanceText = fmtDistance(haversineKm(req.profile.latitude, req.profile.longitude, row.latitude, row.longitude));
      if (row.conv_id) {
        const lm = await db.query('SELECT body FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 1', [row.conv_id]);
        row.lastBody = lm.rows.length ? lm.rows[0].body : '';
        const uc = await db.query(
          `SELECT COUNT(*)::int AS n FROM messages m LEFT JOIN conversation_reads rd
           ON rd.conversation_id=m.conversation_id AND rd.user_id=$1
           WHERE m.conversation_id=$2 AND m.sender_user_id<>$1
           AND m.created_at > COALESCE(rd.last_read_at,'1970-01-01')`, [req.user.id, row.conv_id]);
        row.unread = uc.rows[0].n;
      } else { row.lastBody = ''; row.unread = 0; }
    }
    res.render('matches', { title: res.locals.t('matches'), items: r.rows });
  } catch (e) { next(e); }
});

// ---- Public profile ----
router.get('/u/:id', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.redirect('/profile');
    const r = await db.query(
      `SELECT u.id, u.name, u.gender, u.age, u.is_premium, p.*
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
    const matched = await db.query('SELECT id FROM matches WHERE (user_a_id=$1 AND user_b_id=$2) OR (user_a_id=$2 AND user_b_id=$1)',
      [req.user.id, id]);
    const blocked = await db.query('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [req.user.id, id]);
    res.render('profile-public', {
      title: other.name, other, distanceText: fmtDistance(dist), score,
      interestsList: splitList(other.interests), swiped: sw.rows[0] || null,
      matched: matched.rows[0] || null, isBlocked: blocked.rows.length > 0,
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
      req.session.flash = { type: 'err', msg: t('alreadyReported') };
      return res.redirect('/u/' + id);
    }
    await db.query('INSERT INTO reports(reporter_user_id,reported_user_id,reason) VALUES($1,$2,$3)',
      [req.user.id, id, reason]);
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
module.exports.matchCount = matchCount;
