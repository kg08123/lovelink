// Premium paywall: first 3 direct likes free, then Premium unlock via
// manual receipt (Telebirr / CBE numbers from env, receipt image upload,
// admin approves). Like-backs are always free; like-back chats cap at
// 10 sends (see lib/paywall.js).
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ensureMatchesFor } = require('./discover');
const { FREE_LIKES, directLikesUsed } = require('../lib/paywall');
const router = express.Router();

const PREMIUM_FEE = Number(process.env.PREMIUM_FEE_ETB || 99);

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// Paywall page: shows free likes used, price, payment numbers, receipt form
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const n = await directLikesUsed(req.user.id);
    const pending = await db.query(
      "SELECT * FROM payments WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1",
      [req.user.id]);
    const last = await db.query(
      "SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [req.user.id]);
    res.render('premium', {
      title: res.locals.t('premiumTitle'),
      likesUsed: n, freeLeft: Math.max(0, FREE_LIKES - n),
      fee: PREMIUM_FEE, pending: pending.rows[0] || null,
      lastPayment: last.rows[0] || null,
      blocked: req.query.blocked === '1',
    });
  } catch (e) { next(e); }
});

// Submit receipt
router.post('/', requireAuth, (req, res, next) => {
  receiptUpload.single('receipt')(req, res, (err) => {
    if (err) {
      req.session.flash = { type: 'err', msg: err.message };
      return res.redirect('/premium');
    }
    next();
  });
}, async (req, res, next) => {
  try {
    const t = res.locals.t;
    if (req.user.is_premium) return res.redirect('/discover');
    const dup = await db.query(
      "SELECT id FROM payments WHERE user_id=$1 AND status='pending'", [req.user.id]);
    if (dup.rows.length) {
      req.session.flash = { type: 'err', msg: t('paymentPending') };
      return res.redirect('/premium');
    }
    if (!req.file || !req.file.buffer) {
      req.session.flash = { type: 'err', msg: t('receiptRequired') };
      return res.redirect('/premium');
    }
    const { processPhoto, makeThumb } = require('../lib/photos');
    const receiptData = await processPhoto(req.file.buffer, req.file.mimetype, { maxWidth: 1080, quality: 85 });
    // Thumbnail for the admin list (200px display); full receipt opens on tap.
    const receiptThumb = (await makeThumb(req.file.buffer, req.file.mimetype, { maxWidth: 480, quality: 75 })) || receiptData;
    await db.query(
      "INSERT INTO payments(user_id,receipt_data,receipt_thumb,amount_etb,status,type) VALUES($1,$2,$3,$4,'pending','premium')",
      [req.user.id, receiptData, receiptThumb, PREMIUM_FEE]);
    req.session.flash = { type: 'ok', msg: t('paymentSent') };
    res.redirect('/premium');
  } catch (e) { next(e); }
});

// Admin approves a premium payment: unlock premium + create pending mutual matches.
// (Called from routes/admin.js; also exported for reuse.)
async function approvePremiumPayment(paymentId) {
  const p = await db.query('SELECT user_id, status FROM payments WHERE id=$1', [paymentId]);
  if (!p.rows.length || p.rows[0].status !== 'pending') return null;
  await db.query("UPDATE payments SET status='approved' WHERE id=$1", [paymentId]);
  await db.query('UPDATE users SET is_premium=TRUE WHERE id=$1', [p.rows[0].user_id]);
  const created = await ensureMatchesFor(p.rows[0].user_id);
  return { userId: p.rows[0].user_id, createdMatches: created };
}

module.exports = router;
module.exports.approvePremiumPayment = approvePremiumPayment;
