// Auth: signup (18+ only, one phone = one account), sign-in, email verify,
// forgot/reset password. Google sign-in only when GOOGLE_* env vars are set.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { notify } = require('../lib/notify');
const { googleEnabled, passport } = require('../lib/google');
const router = express.Router();

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : (req.profile ? '/discover' : '/onboarding'));
  const form = req.session.signupAttempt || {};
  delete req.session.signupAttempt;
  res.render('auth/signup', { title: res.locals.t('signUp'), form });
});

router.post('/signup', async (req, res, next) => {
  try {
    const t = res.locals.t;
    const { name, phone, password, email, gender, age } = req.body;
    const stash = () => { req.session.signupAttempt = { name, phone, email, gender, age }; };
    if (!name || !phone || !password) {
      req.session.flash = { type: 'err', msg: t('fillAll') };
      stash();
      return res.redirect('/signup');
    }
    if (!['male', 'female'].includes(gender)) {
      req.session.flash = { type: 'err', msg: t('fillAll') };
      stash();
      return res.redirect('/signup');
    }
    const ageNum = parseInt((age || '').toString().trim(), 10);
    if (!Number.isInteger(ageNum) || ageNum < 18 || ageNum > 100) {
      req.session.flash = { type: 'err', msg: t('invalidAge') };
      stash();
      return res.redirect('/signup');
    }
    const emailTrim = (email || '').trim().toLowerCase();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      req.session.flash = { type: 'err', msg: t('invalidEmail') };
      stash();
      return res.redirect('/signup');
    }
    const exists = await db.query('SELECT id FROM users WHERE phone=$1', [phone.trim()]);
    if (exists.rows.length) {
      req.session.flash = { type: 'err', msg: t('phoneTaken') };
      stash();
      return res.redirect('/signup');
    }
    if (emailTrim) {
      const emailExists = await db.query('SELECT id FROM users WHERE email=$1', [emailTrim]);
      if (emailExists.rows.length) {
        req.session.flash = { type: 'err', msg: t('emailTaken') };
        stash();
        return res.redirect('/signup');
      }
    }
    const hash = await bcrypt.hash(password, 10);
    const emailToken = emailTrim ? crypto.randomBytes(32).toString('hex') : null;
    const u = await db.query(
      "INSERT INTO users(role,name,phone,password_hash,email,email_token,gender,age) VALUES('user',$1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [name.trim(), phone.trim(), hash, emailTrim || null, emailToken, gender, ageNum]
    );
    const userId = u.rows[0].id;
    await notify(db, userId, 'welcome', '/welcome', 'welcomeTitle', 'welcomeBody');
    if (emailToken) {
      const { sendVerificationEmail, mailerEnabled, BASE_URL } = require('../lib/mailer');
      if (mailerEnabled()) {
        try { await sendVerificationEmail(emailTrim, `${BASE_URL}/verify-email/${emailToken}`); }
        catch (e) { console.error('[mailer] send failed:', e.message); }
      } else {
        console.log('[mailer] dev verify link: ' + BASE_URL + '/verify-email/' + emailToken);
      }
      req.session.pendingVerificationEmail = emailTrim;
      return res.redirect('/verify-email');
    }
    req.session.userId = userId;
    res.redirect('/onboarding');
  } catch (e) { next(e); }
});

router.get('/signin', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : (req.profile ? '/discover' : '/onboarding'));
  const login = req.session.loginAttempt || '';
  delete req.session.loginAttempt;
  res.render('auth/signin', { title: res.locals.t('signIn'), login });
});

router.post('/signin', async (req, res, next) => {
  try {
    const t = res.locals.t;
    const { password } = req.body;
    const login = (req.body.login || '').trim();
    const r = login.includes('@')
      ? await db.query('SELECT * FROM users WHERE email=$1', [login.toLowerCase()])
      : await db.query('SELECT * FROM users WHERE phone=$1', [login]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      req.session.flash = { type: 'err', msg: t('invalidLogin') };
      req.session.loginAttempt = login;
      return res.redirect('/signin');
    }
    if (user.is_banned) {
      req.session.flash = { type: 'err', msg: t('noAccess') };
      return res.redirect('/signin');
    }
    if (user.email && !user.email_verified) {
      req.session.pendingVerificationEmail = user.email;
      req.session.flash = { type: 'err', msg: t('verifyFirst') };
      return res.redirect('/verify-email');
    }
    req.session.userId = user.id;
    if (user.role === 'admin') return res.redirect('/admin');
    const p = await db.query('SELECT user_id FROM profiles WHERE user_id=$1', [user.id]);
    return res.redirect(p.rows.length ? '/discover' : '/onboarding');
  } catch (e) { next(e); }
});

router.get('/signout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---- Google Sign-In (only when GOOGLE_CLIENT_ID/SECRET are set) ----
if (googleEnabled && passport) {
  router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  router.get('/auth/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/signin' }),
    async (req, res, next) => {
      try {
        const gid = req.user.id;
        const r = await db.query('SELECT * FROM users WHERE google_id=$1', [gid]);
        if (r.rows.length) {
          const u = r.rows[0];
          if (u.is_banned) return res.redirect('/signin');
          const em = (req.user.emails && req.user.emails[0] && req.user.emails[0].value) || null;
          const av = (req.user.photos && req.user.photos[0] && req.user.photos[0].value) || null;
          if ((!u.avatar_url && av) || (!u.email && em)) {
            await db.query('UPDATE users SET avatar_url=COALESCE(avatar_url,$1), email=COALESCE(email,$2) WHERE id=$3',
              [av, em, u.id]);
          }
          req.session.userId = u.id;
          if (u.role === 'admin') return res.redirect('/admin');
          const p = await db.query('SELECT user_id FROM profiles WHERE user_id=$1', [u.id]);
          return res.redirect(p.rows.length ? '/discover' : '/onboarding');
        }
        req.session.pendingGoogle = {
          google_id: gid,
          name: (req.user.displayName || '').trim(),
          email: (req.user.emails && req.user.emails[0] && req.user.emails[0].value) || null,
          avatar_url: (req.user.photos && req.user.photos[0] && req.user.photos[0].value) || null,
        };
        res.redirect('/signup/google');
      } catch (e) { next(e); }
    });

  router.get('/signup/google', (req, res) => {
    if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : (req.profile ? '/discover' : '/onboarding'));
    if (!req.session.pendingGoogle) return res.redirect('/signup');
    res.render('auth/signup-google', { title: res.locals.t('signUp'), g: req.session.pendingGoogle });
  });

  router.post('/signup/google', async (req, res, next) => {
    try {
      const pg = req.session.pendingGoogle;
      if (!pg) return res.redirect('/signup');
      const t = res.locals.t;
      const { name, phone, gender, age } = req.body;
      if (!name || !phone || !['male', 'female'].includes(gender)) {
        req.session.flash = { type: 'err', msg: t('fillAll') };
        return res.redirect('/signup/google');
      }
      const ageNum = parseInt((age || '').toString().trim(), 10);
      if (!Number.isInteger(ageNum) || ageNum < 18 || ageNum > 100) {
        req.session.flash = { type: 'err', msg: t('invalidAge') };
        return res.redirect('/signup/google');
      }
      const exists = await db.query('SELECT id FROM users WHERE phone=$1', [phone.trim()]);
      if (exists.rows.length) {
        req.session.flash = { type: 'err', msg: t('phoneTaken') };
        return res.redirect('/signup/google');
      }
      const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
      const gEmail = (pg.email || '').trim().toLowerCase() || null;
      if (gEmail) {
        const emailExists = await db.query('SELECT id FROM users WHERE email=$1', [gEmail]);
        if (emailExists.rows.length) {
          req.session.flash = { type: 'err', msg: t('invalidEmail') };
          return res.redirect('/signup/google');
        }
      }
      const u = await db.query(
        "INSERT INTO users(role,name,phone,password_hash,google_id,email,avatar_url,email_verified,gender,age) VALUES('user',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        [name.trim(), phone.trim(), hash, pg.google_id, gEmail, pg.avatar_url, Boolean(gEmail), gender, ageNum]
      );
      delete req.session.pendingGoogle;
      req.session.userId = u.rows[0].id;
      await notify(db, u.rows[0].id, 'welcome', '/welcome', 'welcomeTitle', 'welcomeBody');
      res.redirect('/onboarding');
    } catch (e) { next(e); }
  });
}

// Email verification
router.get('/verify-email', (req, res) => {
  res.render('auth/verify-email', { title: res.locals.t('verifyEmailTitle'), email: req.session.pendingVerificationEmail || '' });
});

router.post('/verify-email/resend', async (req, res, next) => {
  try {
    const t = res.locals.t;
    const email = (req.body.email || req.session.pendingVerificationEmail || '').trim().toLowerCase();
    if (email) {
      const r = await db.query('SELECT id, email_verified FROM users WHERE email=$1', [email]);
      if (r.rows.length && !r.rows[0].email_verified) {
        const token = crypto.randomBytes(32).toString('hex');
        await db.query('UPDATE users SET email_token=$1 WHERE id=$2', [token, r.rows[0].id]);
        const { sendVerificationEmail, mailerEnabled, BASE_URL } = require('../lib/mailer');
        if (mailerEnabled()) {
          try { await sendVerificationEmail(email, `${BASE_URL}/verify-email/${token}`); }
          catch (e) { console.error('[mailer] resend failed:', e.message); }
        } else {
          console.log('[mailer] dev verify link: ' + BASE_URL + '/verify-email/' + token);
        }
      }
    }
    req.session.flash = { type: 'ok', msg: t('checkInbox') };
    res.redirect('/verify-email');
  } catch (e) { next(e); }
});

router.get('/verify-email/:token', async (req, res, next) => {
  try {
    const t = res.locals.t;
    const r = await db.query('SELECT id, email_verified FROM users WHERE email_token=$1', [req.params.token]);
    if (!r.rows.length) {
      req.session.flash = { type: 'err', msg: t('invalidToken') };
      return res.redirect(req.session.userId ? '/onboarding' : '/signin');
    }
    await db.query('UPDATE users SET email_verified=TRUE, email_token=NULL WHERE id=$1', [r.rows[0].id]);
    delete req.session.pendingVerificationEmail;
    req.session.flash = { type: 'ok', msg: t('emailVerified') };
    if (req.session.userId) return res.redirect('/onboarding');
    req.session.userId = r.rows[0].id;
    res.redirect('/onboarding');
  } catch (e) { next(e); }
});

// Forgot password: ask for email, send reset link (never reveals whether the email exists)
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', { title: res.locals.t('forgotPassword') });
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    const t = res.locals.t;
    const email = (req.body.email || '').trim().toLowerCase();
    if (email) {
      const r = await db.query('SELECT id FROM users WHERE email=$1', [email]);
      if (r.rows.length) {
        const token = crypto.randomBytes(32).toString('hex');
        await db.query("UPDATE users SET reset_token=$1, reset_expires=NOW() + INTERVAL '1 hour' WHERE id=$2", [token, r.rows[0].id]);
        const { sendPasswordResetEmail, mailerEnabled, BASE_URL } = require('../lib/mailer');
        if (mailerEnabled()) {
          try { await sendPasswordResetEmail(email, `${BASE_URL}/reset-password/${token}`); }
          catch (e) { console.error('[mailer] reset send failed:', e.message); }
        } else {
          // Dev fallback: no email provider configured — print the link to the server log.
          console.log('[mailer] dev reset link for ' + email + ': ' + BASE_URL + '/reset-password/' + token);
        }
      }
    }
    req.session.flash = { type: 'ok', msg: t('resetLinkSent') };
    res.redirect('/signin');
  } catch (e) { next(e); }
});

router.get('/reset-password/:token', async (req, res, next) => {
  try {
    const t = res.locals.t;
    const r = await db.query('SELECT id FROM users WHERE reset_token=$1 AND reset_expires > NOW()', [req.params.token]);
    if (!r.rows.length) {
      req.session.flash = { type: 'err', msg: t('invalidResetToken') };
      return res.redirect('/forgot-password');
    }
    res.render('auth/reset-password', { title: t('resetPassword'), token: req.params.token });
  } catch (e) { next(e); }
});

router.post('/reset-password/:token', async (req, res, next) => {
  try {
    const t = res.locals.t;
    const { password, password2 } = req.body;
    const r = await db.query('SELECT id FROM users WHERE reset_token=$1 AND reset_expires > NOW()', [req.params.token]);
    if (!r.rows.length) {
      req.session.flash = { type: 'err', msg: t('invalidResetToken') };
      return res.redirect('/forgot-password');
    }
    if (!password || password.length < 4 || password !== password2) {
      req.session.flash = { type: 'err', msg: t('passwordsDontMatch') };
      return res.redirect('/reset-password/' + req.params.token);
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash=$1, reset_token=NULL, reset_expires=NULL WHERE id=$2', [hash, r.rows[0].id]);
    req.session.flash = { type: 'ok', msg: t('passwordResetOk') };
    res.redirect('/signin');
  } catch (e) { next(e); }
});

module.exports = router;
