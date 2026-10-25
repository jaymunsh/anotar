import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const MAX_IMAGES = 4;

// A memo's image attachments, shrunk for a vision model: long edge ≤2048px, metadata
// (GPS etc.) dropped. Originals stay untouched; copies live only for one run.
export function createImageLoader({ store, dataDir }) {
  return async (job) => {
    const files = (job.captureId && store.getCapture(job.captureId)?.files) || [];
    const base = await realpath(join(dataDir, 'blobs')).catch(() => null);
    const images = [];
    for (const file of files) {
      if (!base || images.length >= MAX_IMAGES || !/^image\/(png|jpeg|webp)$/.test(file.mime)) continue;
      try {
        const path = await realpath(resolve(base, file.key));
        if (!path.startsWith(base + '/')) continue;
        const png = file.mime === 'image/png';
        const shrunk = sharp(path, { limitInputPixels: 50_000_000 })
          .rotate()
          .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
        const data = await (png ? shrunk.png() : shrunk.jpeg({ quality: 85 })).toBuffer();
        images.push({ name: `image-${images.length + 1}.${png ? 'png' : 'jpg'}`, data });
      } catch {
        // An unreadable image is skipped; the request still runs on what remains.
      }
    }
    return images;
  };
}
