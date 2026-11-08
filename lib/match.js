// Matching helpers: distance (haversine, km) + match score (0-100).
function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDistance(km) {
  if (km == null) return null;
  if (km < 1) return Math.max(100, Math.round(km * 1000)) + ' m away';
  return Math.round(km) + ' km away';
}

function splitList(s) {
  return String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

// me = {age, gender, profile row}, other = {age, gender, profile row}
// Score: shared interests (max 40) + age-range fit (20) + distance (20)
//        + relationship goal (10) + lifestyle smoking/drinking (10) = 100.
function matchScore(me, other, distanceKm) {
  let score = 0;
  const shared = splitList(me.interests).filter((i) => splitList(other.interests).includes(i));
  score += Math.min(40, shared.length * 8);
  if (other.age >= (me.age_min ?? 18) && other.age <= (me.age_max ?? 99)) score += 10;
  if (me.age >= (other.age_min ?? 18) && me.age <= (other.age_max ?? 99)) score += 10;
  if (distanceKm == null) score += 5;
  else if (distanceKm <= 2) score += 20;
  else if (distanceKm <= 5) score += 16;
  else if (distanceKm <= 10) score += 12;
  else if (distanceKm <= 25) score += 8;
  else if (distanceKm <= 50) score += 4;
  if (me.relationship_goal && me.relationship_goal === other.relationship_goal) score += 10;
  if (me.smoking && me.smoking === other.smoking) score += 5;
  if (me.drinking && me.drinking === other.drinking) score += 5;
  return Math.min(100, score);
}

module.exports = { haversineKm, fmtDistance, splitList, matchScore };
