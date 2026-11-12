// Paywall rules, shared by the swipe flow, the chat routes, the profile
// page and the free-match counters. One place, so the rule can never
// drift between "can this match exist" and "can this user chat here".
//
// The rule: the first 3 matches YOU INITIATE are free; the 4th+ needs
// Premium. A match you did NOT initiate — someone liked you first and
// you liked back — is always free to chat in, no matter how many free
// matches you have left. Premium unlocks everything.
//
// Who initiated a match is recorded in matches.initiated_by_id. Matches
// formed before that column existed have NULL: existing behavior for
// them (chat allowed, and they still count against the budget, so nobody
// gains a free match from the change itself).
const db = require('../db');

const FREE_MATCHES = 3;

// How many of the user's free matches are spent: matches they initiated
// plus pre-change matches (NULL initiator, counted for both parties so
// the old budget is preserved exactly).
async function freeBudgetUsed(userId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM matches
     WHERE (user_a_id=$1 OR user_b_id=$1)
       AND (initiated_by_id=$1 OR initiated_by_id IS NULL)`,
    [userId]);
  return r.rows[0].n;
}

// May userId chat in this match? matchRow needs {id, initiated_by_id}.
// - Premium: always.
// - Pre-change match (NULL initiator): always (existing behavior).
// - Responder (someone else initiated): always (like-back bypass).
// - Initiator: free while this match is within the first FREE_MATCHES
//   budget-consuming matches (initiated + pre-change), ordered by match
//   id, which increases with creation order.
async function canChatInMatch(userId, isPremium, matchRow) {
  if (isPremium) return true;
  if (!matchRow || matchRow.initiated_by_id == null) return true;
  if (matchRow.initiated_by_id !== userId) return true;
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM matches
     WHERE (user_a_id=$1 OR user_b_id=$1)
       AND ((initiated_by_id=$1 AND id <= $2) OR initiated_by_id IS NULL)`,
    [userId, matchRow.id]);
  return r.rows[0].n <= FREE_MATCHES;
}

module.exports = { FREE_MATCHES, freeBudgetUsed, canChatInMatch };
