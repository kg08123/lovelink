// Demo auto-match: a DEMO user likes back 60 seconds after a real user
// likes (or super-likes) them, so testing feels alive without a real person
// on the other side. Real users NEVER auto-match — they must like back
// themselves.
//
// Surviving the free tier sleeping: the sweep runs on every Discover /
// Matches / Explore / Messages page load for that user (the reliable path),
// plus a 30s server interval as a backup while the server is awake.
// No setTimeout is ever used to schedule a match.
//
// Paywall: if the user is not premium and already has 3 matches, the
// demo's like-back swipe IS recorded, but no match is created yet — the
// existing ensureMatchesFor() creates it when the user goes Premium.
const db = require('../db');
const { notify } = require('./notify');

const AUTO_MATCH_SECONDS = 60;
const FREE_MATCHES = 3;
const GREETINGS = [
  'Hey! Nice to match with you!',
  'Hi! Glad we matched — how is your day going?',
  'Hey there! Great to match with you. What are you up to?',
];

// One user: find their likes to demo users that are >=60s old with no
// like-back and no match yet, and let the demo like back.
async function processDemoAutoMatches(user) {
  if (!user || user.role !== 'user') return [];
  const cutoff = new Date(Date.now() - AUTO_MATCH_SECONDS * 1000).toISOString();
  let rows;
  try {
    // NOTE: no correlated NOT EXISTS subqueries here — pg-mem cannot
    // resolve the outer alias inside them ("column s.to_user_id does not
    // exist"), and the same query must run unchanged on real Postgres.
    // The per-candidate checks below are simple queries the codebase
    // already uses everywhere.
    const r = await db.query(
      `SELECT s.to_user_id AS demo_id, u.name AS demo_name
       FROM swipes s JOIN users u ON u.id = s.to_user_id
       WHERE s.from_user_id=$1 AND s.kind IN ('like','super')
         AND s.created_at <= $2
         AND u.is_demo = TRUE AND u.is_banned = FALSE AND u.role='user'`,
      [user.id, cutoff]);
    rows = r.rows;
  } catch (e) {
    console.error('[demo-auto] sweep query failed:', e.message);
    return [];
  }
  // Lazy-require: discover.js requires this file, so requiring it at the
  // top would be a load-time cycle. By call time it is fully loaded.
  const { matchCount, createMatch } = require('../routes/discover');
  const created = [];
  for (const row of rows) {
    try {
      // Skip if already matched, already liked back, or blocked either way.
      const likedBack = await db.query(
        "SELECT 1 FROM swipes WHERE from_user_id=$1 AND to_user_id=$2 AND kind IN ('like','super')",
        [row.demo_id, user.id]);
      if (likedBack.rows.length) continue;
      const matched = await db.query(
        'SELECT id FROM matches WHERE (user_a_id=$1 AND user_b_id=$2) OR (user_a_id=$2 AND user_b_id=$1)',
        [user.id, row.demo_id]);
      if (matched.rows.length) continue;
      const blocked = await db.query(
        'SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',
        [user.id, row.demo_id]);
      if (blocked.rows.length) continue;
      // Demo likes back (recorded even when the paywall holds the match).
      await db.query(
        "INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like') ON CONFLICT (from_user_id,to_user_id) DO NOTHING",
        [row.demo_id, user.id]);
      const n = await matchCount(user.id);
      if (!user.is_premium && n >= FREE_MATCHES) continue;
      const matchId = await createMatch(user.id, row.demo_id);
      const conv = await db.query('SELECT id FROM conversations WHERE match_id=$1', [matchId]);
      if (conv.rows.length) {
        const g = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
        await db.query(
          'INSERT INTO messages(conversation_id, sender_user_id, body) VALUES($1,$2,$3)',
          [conv.rows[0].id, row.demo_id, g]);
      }
      await notify(db, user.id, 'match', '/match/' + matchId, 'itsAMatch', 'matchSub', [row.demo_name]);
      created.push(matchId);
    } catch (e) {
      console.error('[demo-auto] auto-match failed for demo', row.demo_id, e.message);
    }
  }
  return created;
}

// All users (interval backup): find every real user with a pending
// demo like and sweep them one by one. Never throws.
async function processAllDemoAutoMatches() {
  try {
    const r = await db.query(
      `SELECT DISTINCT s.from_user_id AS uid FROM swipes s
       JOIN users u ON u.id = s.to_user_id
       WHERE s.kind IN ('like','super') AND u.is_demo = TRUE`);
    for (const row of r.rows) {
      try {
        const u = await db.query('SELECT * FROM users WHERE id=$1', [row.uid]);
        if (u.rows.length) await processDemoAutoMatches(u.rows[0]);
      } catch (e) { console.error('[demo-auto] user sweep failed:', e.message); }
    }
  } catch (e) { console.error('[demo-auto] global sweep failed:', e.message); }
}

module.exports = { processDemoAutoMatches, processAllDemoAutoMatches, AUTO_MATCH_SECONDS };
