const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { FREE_MATCHES, freeBudgetUsed } = require('../lib/paywall');
const router = express.Router();

const RELIGIONS = ['Any', 'Orthodox', 'Protestant', 'Catholic', 'Muslim', 'Other'];

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const n = await freeBudgetUsed(req.user.id);
    res.render('settings', {
      title: res.locals.t('settings'),
      matchCount: n, freeLeft: Math.max(0, FREE_MATCHES - n),
      religions: RELIGIONS,
    });
  } catch (e) { next(e); }
});

// Match Preferences + Premium Features: these are REAL filters, wired
// into candidate selection (routes/discover.js getCandidates).
// - age range: SQL filter on the other person's age
// - gender: looking_for_gender is stored here, but the deck follows the
//   opposite-gender rule instead (see getCandidates)
// - religion: pref_religion ('Any' = no filter)
// - verified only: only selfie-verified profiles (demos count as verified)
// - incognito: hide me from other people's decks unless they liked me
router.post('/preferences', requireAuth, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const b = req.body;
    let ageMin = Math.max(18, Math.min(99, parseInt(b.age_min, 10) || 18));
    let ageMax = Math.max(18, Math.min(99, parseInt(b.age_max, 10) || 99));
    if (ageMin > ageMax) { const tmp = ageMin; ageMin = ageMax; ageMax = tmp; }
    const lookingFor = ['female', 'male', 'any'].includes(b.looking_for_gender) ? b.looking_for_gender : 'any';
    const prefReligion = RELIGIONS.includes(b.pref_religion) ? b.pref_religion : 'Any';
    const verifiedOnly = b.verified_only === 'on' || b.verified_only === 'true';
    const incognito = b.incognito === 'on' || b.incognito === 'true';
    await db.query(
      `UPDATE profiles SET age_min=$1, age_max=$2, looking_for_gender=$3,
         pref_religion=$4, verified_only=$5, incognito=$6 WHERE user_id=$7`,
      [ageMin, ageMax, lookingFor, prefReligion, verifiedOnly, incognito, req.user.id]);
    req.session.flash = { type: 'ok', msg: t('profileSaved') };
    res.redirect('/settings');
  } catch (e) { next(e); }
});

// Reset Matches: clear ONLY my passes so swiped-past profiles come back
// (same as /discover/reset-passes, reachable from Settings).
router.post('/reset-matches', requireAuth, async (req, res, next) => {
  try {
    await db.query("DELETE FROM swipes WHERE from_user_id=$1 AND kind='pass'", [req.user.id]);
    req.session.flash = { type: 'ok', msg: res.locals.t('passesCleared') };
    res.redirect('/settings');
  } catch (e) { next(e); }
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const t = res.locals.t;
    const { current, password, password2 } = req.body;
    const u = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!u.rows.length || !(await bcrypt.compare(current || '', u.rows[0].password_hash))) {
      req.session.flash = { type: 'err', msg: t('wrongPassword') };
      return res.redirect('/settings');
    }
    if (!password || password.length < 4 || password !== password2) {
      req.session.flash = { type: 'err', msg: t('passwordsDontMatch') };
      return res.redirect('/settings');
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    req.session.flash = { type: 'ok', msg: t('passwordChanged') };
    res.redirect('/settings');
  } catch (e) { next(e); }
});

module.exports = router;
