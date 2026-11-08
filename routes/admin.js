// Admin panel: gated to role='admin'. Real data only — stat cards, users,
// premium payments (approve => premium + pending mutual matches), reports, demo cleanup.
const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { approvePremiumPayment } = require('./premium');
const router = express.Router();

router.use(requireRole('admin'));
const PREMIUM_FEE = Number(process.env.PREMIUM_FEE_ETB || 99);

// Dashboard: tappable stat cards
router.get('/', async (req, res, next) => {
  try {
    const users = await db.query("SELECT COUNT(*) AS c FROM users WHERE role='user'");
    const matches = await db.query('SELECT COUNT(*) AS c FROM matches');
    const messages = await db.query('SELECT COUNT(*) AS c FROM messages');
    const pending = await db.query("SELECT COUNT(*) AS c FROM payments WHERE status='pending'");
    const reports = await db.query("SELECT COUNT(*) AS c FROM reports WHERE status='pending'");
    const premium = await db.query("SELECT COUNT(*) AS c FROM users WHERE is_premium=TRUE");
    const revenue = await db.query("SELECT COUNT(*) AS c FROM payments WHERE status='approved'");
    res.render('admin/dashboard', {
      title: res.locals.t('adminPanel'),
      totalUsers: users.rows[0].c,
      totalMatches: matches.rows[0].c,
      totalMessages: messages.rows[0].c,
      pendingPayments: pending.rows[0].c,
      pendingReports: reports.rows[0].c,
      premiumUsers: premium.rows[0].c,
      revenue: Number(revenue.rows[0].c) * PREMIUM_FEE,
    });
  } catch (e) { next(e); }
});

// All users
router.get('/users', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT u.id, u.role, u.name, u.phone, u.email, u.gender, u.age, u.is_demo, u.is_banned,
              u.is_premium, u.free_matches_used, u.created_at, p.city
       FROM users u LEFT JOIN profiles p ON p.user_id=u.id
       ORDER BY u.created_at DESC LIMIT 200`);
    res.render('admin/users', { title: res.locals.t('allUsers'), users: r.rows });
  } catch (e) { next(e); }
});

// User detail
router.get('/users/:id', async (req, res, next) => {
  try {
    const u = await db.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!u.rows.length) return res.status(404).render('404');
    const user = u.rows[0];
    const p = await db.query('SELECT * FROM profiles WHERE user_id=$1', [user.id]);
    const mc = await db.query('SELECT COUNT(*)::int AS n FROM matches WHERE user_a_id=$1 OR user_b_id=$1', [user.id]);
    const msc = await db.query('SELECT COUNT(*)::int AS n FROM messages WHERE sender_user_id=$1', [user.id]);
    const rc = await db.query("SELECT COUNT(*)::int AS n FROM reports WHERE reported_user_id=$1 AND status='pending'", [user.id]);
    const pay = await db.query('SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [user.id]);
    res.render('admin/user-detail', {
      title: user.name, user, profile: p.rows[0] || null,
      counts: { matches: mc.rows[0].n, messagesSent: msc.rows[0].n, pendingReports: rc.rows[0].n },
      payments: pay.rows,
    });
  } catch (e) { next(e); }
});

// Ban / unban a user
router.post('/users/:id/ban', async (req, res, next) => {
  try {
    await db.query('UPDATE users SET is_banned=TRUE WHERE id=$1 AND role=$2', [req.params.id, 'user']);
    req.session.flash = { type: 'ok', msg: res.locals.t('userBanned') };
    res.redirect('/admin/users/' + req.params.id);
  } catch (e) { next(e); }
});
router.post('/users/:id/unban', async (req, res, next) => {
  try {
    await db.query('UPDATE users SET is_banned=FALSE WHERE id=$1', [req.params.id]);
    req.session.flash = { type: 'ok', msg: res.locals.t('userUnbanned') };
    res.redirect('/admin/users/' + req.params.id);
  } catch (e) { next(e); }
});

// Grant premium directly
router.post('/users/:id/premium', async (req, res, next) => {
  try {
    await db.query('UPDATE users SET is_premium=TRUE WHERE id=$1', [req.params.id]);
    const { ensureMatchesFor } = require('./discover');
    await ensureMatchesFor(Number(req.params.id));
    req.session.flash = { type: 'ok', msg: res.locals.t('premiumGranted') };
    res.redirect('/admin/users/' + req.params.id);
  } catch (e) { next(e); }
});

// Delete one user
router.post('/users/:id/delete', async (req, res, next) => {
  try {
    await db.query("DELETE FROM users WHERE id=$1 AND role='user'", [req.params.id]);
    res.redirect('/admin/users');
  } catch (e) { next(e); }
});

// Premium payment receipts
router.get('/payments', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT p.id, p.receipt_data, p.amount_etb, p.status, p.created_at, p.user_id,
              u.name AS user_name, u.phone AS user_phone
       FROM payments p JOIN users u ON u.id=p.user_id
       WHERE p.status='pending' ORDER BY p.created_at DESC`);
    res.render('admin/payments', { title: res.locals.t('paymentReceipts'), payments: r.rows });
  } catch (e) { next(e); }
});

router.post('/payments/:id/:action', async (req, res, next) => {
  try {
    const ok = req.params.action === 'approve';
    if (ok) {
      await approvePremiumPayment(req.params.id);
      req.session.flash = { type: 'ok', msg: res.locals.t('premiumGranted') };
    } else {
      await db.query("UPDATE payments SET status='rejected' WHERE id=$1", [req.params.id]);
    }
    res.redirect('/admin/payments');
  } catch (e) { next(e); }
});

// Reports queue
router.get('/reports', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT rp.id, rp.reason, rp.status, rp.created_at,
              ru.name AS reporter_name, ru.phone AS reporter_phone,
              du.id AS reported_id, du.name AS reported_name, du.phone AS reported_phone
       FROM reports rp
       JOIN users ru ON ru.id=rp.reporter_user_id
       JOIN users du ON du.id=rp.reported_user_id
       WHERE rp.status='pending' ORDER BY rp.created_at DESC`);
    res.render('admin/reports', { title: res.locals.t('reportsQueue'), reports: r.rows });
  } catch (e) { next(e); }
});

router.post('/reports/:id/dismiss', async (req, res, next) => {
  try {
    await db.query("UPDATE reports SET status='dismissed' WHERE id=$1", [req.params.id]);
    res.redirect('/admin/reports');
  } catch (e) { next(e); }
});

router.post('/reports/:id/ban', async (req, res, next) => {
  try {
    const r = await db.query('SELECT reported_user_id FROM reports WHERE id=$1', [req.params.id]);
    if (r.rows.length) {
      await db.query('UPDATE users SET is_banned=TRUE WHERE id=$1', [r.rows[0].reported_user_id]);
      await db.query("UPDATE reports SET status='actioned' WHERE id=$1", [req.params.id]);
    }
    res.redirect('/admin/reports');
  } catch (e) { next(e); }
});

// Delete ALL demo data in one action (demo users + everything tied to them)
router.post('/delete-demo', async (req, res, next) => {
  try {
    await db.query('DELETE FROM users WHERE is_demo=TRUE AND role=$1', ['user']);
    req.session.flash = { type: 'ok', msg: res.locals.t('demoDeleted') };
    res.redirect('/admin');
  } catch (e) { next(e); }
});

module.exports = router;
