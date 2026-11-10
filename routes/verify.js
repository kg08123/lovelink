// Selfie verification: the user takes a selfie in the reference pose,
// an admin compares it with the profile photo, and approval grants the
// blue verified badge (users.selfie_verified). The selfie is shown ONLY
// to the admin — never on any public profile. One pending selfie per
// user at a time; a new submission replaces the old pending one.
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../lib/notify');
const router = express.Router();

const selfieUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

function requireOnboarded(req, res, next) {
  if (!req.user) return res.redirect('/signin');
  if (!req.profile) return res.redirect('/onboarding');
  next();
}

async function latestVerification(userId) {
  const r = await db.query(
    'SELECT * FROM verifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]);
  return r.rows[0] || null;
}

// The pose photo: a real stock portrait if one was sourced, else null and
// the page draws a clean SVG pose guide instead (never a watermarked or
// AI-labelled image).
const POSE_FILE = path.join(__dirname, '..', 'public', 'img', 'verify-pose.jpg');

router.get('/', requireAuth, requireOnboarded, async (req, res, next) => {
  try {
    const v = await latestVerification(req.user.id);
    const status = req.user.selfie_verified ? 'verified' : (v ? v.status : 'none');
    res.render('verify', {
      title: res.locals.t('getVerified'),
      status,
      verification: v,
      poseImg: fs.existsSync(POSE_FILE) ? '/img/verify-pose.jpg' : null,
    });
  } catch (e) { next(e); }
});

router.post('/submit', requireAuth, requireOnboarded, (req, res, next) => {
  selfieUpload.single('selfie')(req, res, (err) => {
    if (err) {
      req.session.flash = { type: 'err', msg: err.message };
      return res.redirect('/verify');
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      req.session.flash = { type: 'err', msg: res.locals.t('chooseImage') };
      return res.redirect('/verify');
    }
    // Same shrink pipeline as profile photos: a phone selfie becomes ~126KB.
    const { processPhoto } = require('../lib/photos');
    const photo = await processPhoto(req.file.buffer, req.file.mimetype);
    await db.query("DELETE FROM verifications WHERE user_id=$1 AND status='pending'", [req.user.id]);
    await db.query("INSERT INTO verifications(user_id, photo, status) VALUES($1,$2,'pending')",
      [req.user.id, photo]);
    req.session.flash = { type: 'ok', msg: res.locals.t('verifyPending') };
    res.redirect('/verify');
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.latestVerification = latestVerification;
