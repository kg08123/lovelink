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

module.exports = { processPhoto };
