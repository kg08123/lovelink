// Messaging: a conversation exists only inside a match.
// Poll every 3s, optimistic send, image messages (base64 in DB, 3MB cap).
// Paywall (see lib/paywall.js): opening and reading a thread is NEVER
// blocked. Only SENDING is gated: a non-Premium like-backer may send up
// to 10 messages in that match; the 11th send is blocked server-side.
// The initiator of a match and Premium users send unlimited.
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { presenceOf } = require('../lib/presence');
const { canSendInMatch } = require('../lib/paywall');
const router = express.Router();

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // shrunk with Sharp before storing
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// Inbox time label, EAT: today -> "6:21 AM", older -> "11/08/26" (reference style).
const EAT = 'Africa/Addis_Ababa';
function fmtInboxTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: EAT, year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day.format(dt) === day.format(new Date())) {
    return new Intl.DateTimeFormat('en-US', { timeZone: EAT, hour: 'numeric', minute: '2-digit', hour12: true }).format(dt);
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: EAT, month: '2-digit', day: '2-digit', year: '2-digit' }).format(dt);
}

async function getConv(id, userId) {
  const r = await db.query(
    `SELECT c.id, c.match_id, c.user_a_id, c.user_b_id, c.created_at,
            m.initiated_by_id,
            CASE WHEN c.user_a_id=$1 THEN bu.name ELSE au.name END AS other_name,
            CASE WHEN c.user_a_id=$1 THEN bu.id ELSE au.id END AS other_id,
            CASE WHEN c.user_a_id=$1 THEN bp.photo1_thumb ELSE ap.photo1_thumb END AS other_thumb,
            CASE WHEN c.user_a_id=$1 THEN bp.photo1 ELSE ap.photo1 END AS other_photo,
            CASE WHEN c.user_a_id=$1 THEN bp.online ELSE ap.online END AS other_online,
            CASE WHEN c.user_a_id=$1 THEN bu.selfie_verified ELSE au.selfie_verified END AS other_selfie_verified,
            CASE WHEN c.user_a_id=$1 THEN bu.is_demo ELSE au.is_demo END AS other_is_demo,
            CASE WHEN c.user_a_id=$1 THEN bp.last_active ELSE ap.last_active END AS other_last_active
     FROM conversations c
     JOIN matches m ON m.id = c.match_id
     JOIN users au ON au.id=c.user_a_id
     JOIN users bu ON bu.id=c.user_b_id
     LEFT JOIN profiles ap ON ap.user_id=c.user_a_id
     LEFT JOIN profiles bp ON bp.user_id=c.user_b_id
     WHERE c.id=$2 AND (c.user_a_id=$1 OR c.user_b_id=$1)`,
    [userId, id]);
  return r.rows[0];
}

// Send gate for one conversation: false means the viewer is a
// non-Premium like-backer who already sent 10 messages in this match —
// no more sending until Premium. Reading and polling are never gated.
// Never decided client-side.
async function sendAllowed(req, conv) {
  return canSendInMatch(req.user.id, !!req.user.is_premium,
    { id: conv.match_id, initiated_by_id: conv.initiated_by_id });
}

// Gated answer: XHR callers get a 403 they can react to (the thread's
// optimistic send falls back to a plain submit, which lands here too);
// plain page loads go to the Premium page with the upsell flash.
function gatedAnswer(req, res) {
  if (req.xhr) return res.status(403).json({ error: 'premium_required' });
  req.session.flash = { type: 'err', msg: res.locals.t('premiumNeeded') };
  return res.redirect('/premium?blocked=1');
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
    // Demo auto-match sweep: a demo who liked back shows up here.
    if (req.user && req.user.role === 'user') {
      try {
        const { processDemoAutoMatches } = require('../lib/demo-auto');
        await processDemoAutoMatches(req.user);
      } catch (e) { console.error('[demo-auto] inbox sweep failed:', e.message); }
    }
    const r = await db.query(
      `SELECT c.id, c.match_id, c.created_at,
              CASE WHEN c.user_a_id=$1 THEN bu.name ELSE au.name END AS other_name,
              CASE WHEN c.user_a_id=$1 THEN bu.id ELSE au.id END AS other_id,
              CASE WHEN c.user_a_id=$1 THEN bp.photo1 ELSE ap.photo1 END AS other_photo,
              CASE WHEN c.user_a_id=$1 THEN bp.photo1_thumb ELSE ap.photo1_thumb END AS other_photo_thumb,
              CASE WHEN c.user_a_id=$1 THEN bp.online ELSE ap.online END AS other_online,
              CASE WHEN c.user_a_id=$1 THEN bu.selfie_verified ELSE au.selfie_verified END AS other_selfie_verified,
              CASE WHEN c.user_a_id=$1 THEN bu.is_demo ELSE au.is_demo END AS other_is_demo,
              CASE WHEN c.user_a_id=$1 THEN bp.last_active ELSE ap.last_active END AS other_last_active
       FROM conversations c
       JOIN users au ON au.id=c.user_a_id
       JOIN users bu ON bu.id=c.user_b_id
       LEFT JOIN profiles ap ON ap.user_id=c.user_a_id
       LEFT JOIN profiles bp ON bp.user_id=c.user_b_id
       WHERE c.user_a_id=$1 OR c.user_b_id=$1
       ORDER BY c.created_at DESC`,
      [req.user.id]);
    const { thumbFor, backfillProfileThumb } = require('../lib/thumbs');
    for (const c of r.rows) {
      c.thumb = thumbFor(c.other_photo, c.other_photo_thumb);
      backfillProfileThumb(c.other_id, c.other_photo, c.other_photo_thumb);
    }
    const convs = r.rows;
    // Chat speed: one batched query for last messages + one for unread
    // counts, instead of 2 queries per conversation (N+1).
    if (convs.length) {
      const ids = convs.map((c) => c.id);
      const ph = ids.map((_, i) => `$${i + 1}`).join(',');
      const lm = await db.query(
        `SELECT m.conversation_id, m.body, m.created_at AS last_at, m.image_data IS NOT NULL AS has_image
         FROM messages m
         JOIN (SELECT conversation_id, MAX(id) AS max_id FROM messages
               WHERE conversation_id IN (${ph}) GROUP BY conversation_id) x
           ON x.max_id = m.id`,
        ids);
      const lastByConv = {};
      for (const row of lm.rows) lastByConv[row.conversation_id] = row;
      const uc = await db.query(
        `SELECT m.conversation_id, COUNT(*)::int AS n FROM messages m
         LEFT JOIN conversation_reads rd ON rd.conversation_id=m.conversation_id AND rd.user_id=$${ids.length + 1}
         WHERE m.conversation_id IN (${ph}) AND m.sender_user_id<>$${ids.length + 1}
           AND m.created_at > COALESCE(rd.last_read_at, '1970-01-01')
         GROUP BY m.conversation_id`,
        [...ids, req.user.id]);
      const unreadByConv = {};
      for (const row of uc.rows) unreadByConv[row.conversation_id] = row.n;
      for (const c of convs) {
        const last = lastByConv[c.id];
        c.lastBody = last ? last.body : '';
        c.hasImage = last ? !!last.has_image : false;
        c.unread = unreadByConv[c.id] || 0;
        c.lastAt = last ? last.last_at : c.created_at;
        c.timeLabel = fmtInboxTime(c.lastAt);
      }
    }
    const nr = await db.query(
      'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    const unreadNotifs = nr.rows.filter((n) => !n.is_read).length;
    await db.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE', [req.user.id]);
    // One unified list, newest activity first — chats + the LoveLink
    // platform row sit together, exactly like the reference inbox.
    const rows = convs.map((c) => ({
      kind: 'chat',
      href: '/messages/' + c.id,
      name: c.other_name,
      thumb: c.thumb,
      online: !!c.other_online,
      // Blue badge = selfie-verified or demo; presence from real last_active.
      verified: !!(c.other_selfie_verified || c.other_is_demo),
      presence: presenceOf(c.other_last_active),
      unread: c.unread,
      previewKind: c.hasImage ? 'photo' : (c.lastBody ? 'text' : 'new'),
      previewText: c.lastBody || '',
      timeLabel: c.timeLabel,
      lastAt: c.lastAt,
    }));
    if (nr.rows.length) {
      const latest = nr.rows[0];
      rows.push({
        kind: 'platform',
        href: '/messages/platform/' + latest.id,
        name: 'LoveLink',
        verified: true,
        online: true,
        presence: 'online',
        unread: unreadNotifs,
        previewKind: 'platform',
        previewRaw: latest.body,
        timeLabel: fmtInboxTime(latest.created_at),
        lastAt: latest.created_at,
      });
    }
    rows.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    res.render('messages-inbox', { title: res.locals.t('messages'), rows });
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

// Chat thread — reading is never paywall-gated (only sending is).
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const conv = await getConv(req.params.id, req.user.id);
    if (!conv) return res.status(404).render('404');
    conv.other_presence = presenceOf(conv.other_last_active);
    conv.other_verified = !!(conv.other_selfie_verified || conv.other_is_demo);
    await markRead(conv.id, req.user.id);
    // Latest 50 only — the old LIMIT 100 pulled full base64 image_data for
    // the first 100 messages on every thread open.
    const m = await db.query(
      `SELECT id, body, created_at, sender_user_id, image_data, image_thumb, sender_name FROM (
         SELECT m.id, m.body, m.created_at, m.sender_user_id, m.image_data, m.image_thumb, u.name AS sender_name
         FROM messages m JOIN users u ON u.id=m.sender_user_id
         WHERE m.conversation_id=$1 ORDER BY m.id DESC LIMIT 50
       ) s ORDER BY s.id ASC`, [conv.id]);
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
      `SELECT m.id, m.body, m.created_at, m.sender_user_id, m.image_data, m.image_thumb
       FROM messages m WHERE m.conversation_id=$1 AND m.id>$2 ORDER BY m.id ASC LIMIT 100`,
      [conv.id, after]);
    // Chat speed: the old code did a markRead WRITE on every poll, even
    // when nothing new arrived. Only mark read when a new message from the
    // other side actually came in (thread open already marks read once).
    if (m.rows.some((x) => x.sender_user_id !== req.user.id)) {
      await markRead(conv.id, req.user.id);
    }
    res.json({
      messages: m.rows.map((x) => ({
        id: x.id, body: x.body, created_at: x.created_at, mine: x.sender_user_id === req.user.id,
        has_image: !!x.image_data,
        // Thumbnail inline (small); full photo only when tapped.
        image_data: x.image_thumb || x.image_data || null,
        image_full: x.image_data || null,
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
    if (!(await sendAllowed(req, conv))) return gatedAnswer(req, res);
    const body = ((req.body && req.body.body) || '').trim().slice(0, 2000);
    let imageData = null;
    let imageThumb = null;
    if (req.file && req.file.buffer) {
      const { processPhoto, makeThumb } = require('../lib/photos');
      imageData = await processPhoto(req.file.buffer, req.file.mimetype);
      imageThumb = (await makeThumb(req.file.buffer, req.file.mimetype)) || imageData;
    }
    if (!body && !imageData) return res.redirect('/messages/' + conv.id);
    const ins = await db.query(
      'INSERT INTO messages(conversation_id, sender_user_id, body, image_data, image_thumb) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [conv.id, req.user.id, body, imageData, imageThumb]);
    if (req.xhr) return res.json({ ok: true, id: ins.rows[0].id });
    res.redirect('/messages/' + conv.id);
  } catch (e) { next(e); }
});

module.exports = router;
