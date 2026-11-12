// Paywall rules, shared by the swipe flow, the chat routes, the profile
// page and the free-like counters. One place, so the rule can never
// drift between "can this like happen" and "can this user send here".
//
// THE RULE (like-based):
// - DIRECT LIKE: you like someone who has NOT liked you first. 3 free.
//   A 4th direct like by a non-Premium user is BLOCKED and shows the
//   Premium upsell; the like is NOT recorded. Every direct like counts,
//   match or no match.
// - LIKE-BACK: you like someone who already liked you. ALWAYS allowed,
//   even at 0 free likes, and never consumes the 3. A separate system
//   from direct likes.
// - LIKE-BACK CHAT: a non-Premium like-backer may SEND up to 10
//   messages in that match (1 round = 1 message they send); the 11th
//   send is blocked until Premium. The cap applies to like-back matches
//   ALWAYS, even with free likes left. Reading/receiving is never
//   blocked. The other side's sending follows their own status only.
// - DIRECT-LIKE MATCHES: the initiator chats UNLIMITED — their like
//   already spent one of the 3. Premium unlocks everything.
// - OLD MATCHES (initiated_by_id NULL, formed before the initiator
//   column existed): both sides chat freely, as before.
//
// Classification is recorded durably on swipes.is_direct at creation:
// TRUE = direct (no incoming like existed at that moment), FALSE =
// like-back, NULL = legacy swipe from before this change. Legacy likes
// do NOT count toward the budget — everyone gets a fresh start on
// likes; old MATCHES keep their behavior via the NULL initiator rule.
//
// Who liked first on a match is recorded in matches.initiated_by_id
// (NULL = pre-change match). The initiator of a match is the direct
// liker; the responder is the like-backer.
const db = require('../db');

const FREE_LIKES = 3;
const LIKEBACK_ROUNDS = 10;

// How many of the user's free direct likes are spent: only likes
// recorded as direct AFTER this change (is_direct TRUE). Like-backs
// never count; legacy likes (NULL) never count.
async function directLikesUsed(userId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM swipes
     WHERE from_user_id=$1 AND is_direct=TRUE AND kind IN ('like','super')`,
    [userId]);
  return r.rows[0].n;
}

// May userId send a DIRECT like? Premium: always. Otherwise only while
// fewer than FREE_LIKES direct likes are recorded.
async function canDirectLike(userId, isPremium) {
  if (isPremium) return true;
  return (await directLikesUsed(userId)) < FREE_LIKES;
}

// Has targetId already liked userId? TRUE means a like from userId to
// targetId would be a like-back (always free); FALSE means direct.
async function hasIncomingLike(userId, targetId) {
  const r = await db.query(
    "SELECT 1 FROM swipes WHERE from_user_id=$1 AND to_user_id=$2 AND kind IN ('like','super')",
    [targetId, userId]);
  return r.rows.length > 0;
}

// Messages userId has SENT in a match's conversation (each message row,
// text or image, is one round).
async function sendsUsed(userId, matchId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.match_id=$1 AND m.sender_user_id=$2`,
    [matchId, userId]);
  return r.rows[0].n;
}

// May userId SEND in this match? matchRow needs {id, initiated_by_id}.
// - Premium: always.
// - Pre-change match (NULL initiator): always (existing behavior).
// - Initiator (direct liker): always — the like already spent the budget.
// - Responder (like-backer): up to LIKEBACK_ROUNDS sends, always capped
//   (even with free likes left — the cap is a property of the like-back
//   system, not of the budget).
async function canSendInMatch(userId, isPremium, matchRow) {
  if (isPremium) return true;
  if (!matchRow || matchRow.initiated_by_id == null) return true;
  if (matchRow.initiated_by_id === userId) return true;
  return (await sendsUsed(userId, matchRow.id)) < LIKEBACK_ROUNDS;
}

module.exports = { FREE_LIKES, LIKEBACK_ROUNDS, directLikesUsed, canDirectLike, hasIncomingLike, sendsUsed, canSendInMatch };
