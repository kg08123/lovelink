const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.render('settings', { title: res.locals.t('settings') });
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
