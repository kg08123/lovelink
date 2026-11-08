// Thumbnail helpers: pick the stored thumbnail when one exists, fall back to
// the full photo, and backfill missing thumbnails for older profiles.
// Demo photos are /img/*.jpg files (already small, cached) — they are used
// as-is; only base64 data-URL photos get a generated thumbnail.
const db = require('../db');
const { thumbFromDataUrl } = require('./photos');

function isDataPhoto(s) {
  return typeof s === 'string' && s.startsWith('data:image');
}

// The src to render in a card / grid / avatar: thumb when stored, else full.
function thumbFor(photo, thumb) {
  return thumb || photo || null;
}

// Fire-and-forget backfill: if this profile has a data-URL photo1 but no
// stored thumbnail, generate one and save it. Never throws, never blocks
// the page being rendered — the full photo is served this once, the thumb
// from the next load on. The WHERE guard keeps it from overwriting a thumb
// that was stored at upload time.
function backfillProfileThumb(userId, photo, thumb) {
  if (!userId || thumb || !isDataPhoto(photo)) return;
  thumbFromDataUrl(photo)
    .then((t) => {
      if (!t) return null;
      return db.query(
        'UPDATE profiles SET photo1_thumb=$2 WHERE user_id=$1 AND photo1_thumb IS NULL',
        [userId, t]);
    })
    .catch(() => {});
}

module.exports = { isDataPhoto, thumbFor, backfillProfileThumb };
