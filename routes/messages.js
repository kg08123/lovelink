// Messaging: a conversation exists only inside a match.
// Poll every 2s, optimistic send, image messages (base64 in DB, 3MB cap).
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // shrunk with Sharp before storing
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

async function getConv(id, userId) {
  const r = await db.query(
    `SELECT c.id, c.match_id, c.user_a_id, c.user_b_id, c.created_at,
            CASE WHEN c.user_a_id=$1 THEN bu.name ELSE au.name END AS other_name,
            CASE WHEN c.user_a_id=$1 THEN bu.id ELSE au.id END AS other_id
     FROM conversations c
     JOIN users au ON au.id=c.user_a_id
     JOIN users bu ON bu.id=c.user_b_id
     WHERE c.id=$2 AND (c.user_a_id=$1 OR c.user_b_id=$1)`,
    [userId, id]);
  return r.rows[0];
}

async function unreadFor(convId, userId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM messages m
     LEFT JOIN conversation_reads r ON r.conversation_id=m.conversation_id AND r.user_id=$1
     WHERE m.conversation_id=$2 AND m.sender_user_id<>$1
       AND m.created_at > COALESCE(r.last_read_at, '1970-01-01')`,
    [userId, convId]);
  return r.rows[0].n;
}

async function markRead(convId, userId) {
  await db.query(
    `INSERT INTO conversation_reads(user_id, conversation_id, last_read_at) VALUES($1,$2,NOW())
     ON CONFLICT (user_id, conversation_id) DO UPDATE SET last_read_at=NOW()`,
    [userId, convId]);
}

// Inbox: all my match conversations + platform notifications
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT c.id, c.match_id, c.created_at,
              CASE WHEN c.user_a_id=$1 THEN bu.name ELSE au.name END AS other_name,
              CASE WHEN c.user_a_id=$1 THEN bu.id ELSE au.id END AS other_id,
              CASE WHEN c.user_a_id=$1 THEN bp.photo1 ELSE ap.photo1 END AS other_photo
       FROM conversations c
       JOIN users au ON au.id=c.user_a_id
       JOIN users bu ON bu.id=c.user_b_id
       LEFT JOIN profiles ap ON ap.user_id=c.user_a_id
       LEFT JOIN profiles bp ON bp.user_id=c.user_b_id
       WHERE c.user_a_id=$1 OR c.user_b_id=$1
       ORDER BY c.created_at DESC`,
      [req.user.id]);
    const convs = r.rows;
    for (const c of convs) {
      const lm = await db.query(
        'SELECT body, image_data IS NOT NULL AS has_image FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 1', [c.id]);
      c.lastBody = lm.rows.length ? lm.rows[0].body : '';
      c.hasImage = lm.rows.length ? !!lm.rows[0].has_image : false;
      c.unread = await unreadFor(c.id, req.user.id);
    }
    const nr = await db.query(
      'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    await db.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE', [req.user.id]);
    res.render('messages-inbox', { title: res.locals.t('messages'), convs, notifs: nr.rows });
  } catch (e) { next(e); }
});

// Platform message detail
router.get('/platform/:id', requireAuth, async (req, res, next) => {
  try {
    const r = await db.query('SELECT * FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).render('404');
    await db.query('UPDATE notifications SET is_read=TRUE WHERE id=$1', [req.params.id]);
    res.render('platform-message', { title: res.locals.t('platformMessage') || 'Message', notif: r.rows[0] });
  } catch (e) { next(e); }
});

// Chat thread
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const conv = await getConv(req.params.id, req.user.id);
    if (!conv) return res.status(404).render('404');
    await markRead(conv.id, req.user.id);
    const m = await db.query(
      `SELECT m.id, m.body, m.created_at, m.sender_user_id, m.image_data, u.name AS sender_name
       FROM messages m JOIN users u ON u.id=m.sender_user_id
       WHERE m.conversation_id=$1 ORDER BY m.id ASC LIMIT 100`, [conv.id]);
    res.render('messages-thread', { title: conv.other_name, conv, messages: m.rows, bodyClass: 'chat-page' });
  } catch (e) { next(e); }
});

// JSON poll for new messages (2s refresher)
router.get('/:id/json', requireAuth, async (req, res, next) => {
  try {
    const conv = await getConv(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'not found' });
    if (!req.xhr) return res.redirect('/messages/' + conv.id);
    const after = Number(req.query.after) || 0;
    const m = await db.query(
      `SELECT m.id, m.body, m.created_at, m.sender_user_id, m.image_data
       FROM messages m WHERE m.conversation_id=$1 AND m.id>$2 ORDER BY m.id ASC LIMIT 100`,
      [conv.id, after]);
    await markRead(conv.id, req.user.id);
    res.json({
      messages: m.rows.map((x) => ({
        id: x.id, body: x.body, created_at: x.created_at, mine: x.sender_user_id === req.user.id,
        has_image: !!x.image_data, image_data: x.image_data || null,
      })),
    });
  } catch (e) { next(e); }
});

// Send a message (participants only) — text, image, or both
router.post('/:id', requireAuth, (req, res, next) => {
  chatUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).send('File rejected: ' + err.message);
    next();
  });
}, async (req, res, next) => {
  try {
    const conv = await getConv(req.params.id, req.user.id);
    if (!conv) return res.status(404).render('404');
    const body = ((req.body && req.body.body) || '').trim().slice(0, 2000);
    let imageData = null;
    if (req.file && req.file.buffer) {
      const { processPhoto } = require('../lib/photos');
      imageData = await processPhoto(req.file.buffer, req.file.mimetype);
    }
    if (!body && !imageData) return res.redirect('/messages/' + conv.id);
    const ins = await db.query(
      'INSERT INTO messages(conversation_id, sender_user_id, body, image_data) VALUES($1,$2,$3,$4) RETURNING id',
      [conv.id, req.user.id, body, imageData]);
    if (req.xhr) return res.json({ ok: true, id: ins.rows[0].id });
    res.redirect('/messages/' + conv.id);
  } catch (e) { next(e); }
});

module.exports = router;
