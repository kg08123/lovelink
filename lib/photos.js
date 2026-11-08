// Photo handling: shrink every uploaded photo server-side before it is stored.
// Phone cameras shoot 2-10MB; storing those as base64 made onboarding fail
// (multer 3MB cap) and Discover pages megabytes heavy. Sharp resizes to a
// max width and re-encodes as JPEG, typically 60-150KB.
const sharp = require('sharp');

async function processPhoto(buffer, mimetype, opts = {}) {
  const maxWidth = opts.maxWidth || 720;
  const quality = opts.quality || 80;
  try {
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return 'data:image/jpeg;base64,' + out.toString('base64');
  } catch (e) {
    // Sharp could not read it (rare): keep the original only if small,
    // otherwise fail loudly so the user gets a clear message.
    if (buffer.length <= 500 * 1024 && mimetype && mimetype.startsWith('image/')) {
      return 'data:' + mimetype + ';base64,' + buffer.toString('base64');
    }
    throw new Error('That photo could not be read. Please pick a different photo.');
  }
}

// Small thumbnail for cards, grids and avatars: 360px wide, ~11KB instead of
// ~40-150KB for the full photo. The Discover card renders at 358px wide, so
// 360px is effectively 1:1 there; grids and avatars downscale from it.
// Returns a data URL, or null if the input cannot be read.
async function makeThumb(buffer, mimetype, opts = {}) {
  const maxWidth = opts.maxWidth || 360;
  const quality = opts.quality || 70;
  try {
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return 'data:image/jpeg;base64,' + out.toString('base64');
  } catch (e) {
    return null;
  }
}

// Make a thumbnail from an already-stored data-URL photo (backfill path).
// Returns a data URL, or null when the input is not a readable data URL.
async function thumbFromDataUrl(dataUrl, opts = {}) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
  if (!m) return null;
  try {
    return await makeThumb(Buffer.from(m[1], 'base64'), 'image/jpeg', opts);
  } catch (e) {
    return null;
  }
}

module.exports = { processPhoto, makeThumb, thumbFromDataUrl };
