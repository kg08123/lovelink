// Real presence from profiles.last_active — never faked.
// last_active is stamped on real activity (Discover load + a throttled
// touch in server.js on any authenticated request), so the label means
// what it says:
//   active within 5 min  -> 'online'  (green dot + "Online")
//   active within 24h    -> 'recent'  (amber dot + "Recently Online")
//   older / no data      -> 'none'    (no label at all)
const ONLINE_MS = 5 * 60 * 1000;
const RECENT_MS = 24 * 60 * 60 * 1000;

function presenceOf(lastActive, nowMs) {
  if (!lastActive) return 'none';
  const t = lastActive instanceof Date ? lastActive.getTime() : new Date(lastActive).getTime();
  if (!Number.isFinite(t)) return 'none';
  const age = (nowMs || Date.now()) - t;
  if (age < 0) return 'online'; // clock skew: a future stamp counts as online
  if (age <= ONLINE_MS) return 'online';
  if (age <= RECENT_MS) return 'recent';
  return 'none';
}

module.exports = { presenceOf, ONLINE_MS, RECENT_MS };
