const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Welcome (landing): dark hero like the mockup. Logged-in users go to Discover.
router.get('/', (req, res) => {
  if (req.user) {
    if (req.user.role === 'admin') return res.redirect('/admin');
    return res.redirect('/discover');
  }
  res.render('welcome', { title: 'LoveLink', layout: 'layout', bodyClass: 'landing' });
});

router.get('/about', (req, res) => {
  res.render('about', { title: res.locals.t('aboutTitle') });
});

router.get('/privacy', (req, res) => {
  res.render('privacy', { title: res.locals.t('privacyTitle') });
});

router.get('/welcome', requireAuth, (req, res) => {
  res.render('welcome-logged', { title: res.locals.t('welcomePageTitle') });
});

// Platform notifications live inside the messages inbox
router.get('/notifications', requireAuth, (req, res) => res.redirect('/messages'));

module.exports = router;
