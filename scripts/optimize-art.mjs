// Converts art/*.jpg into responsive AVIF and WebP in public/art. Run after changing the source art.
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';

const widths = [640, 1280, 2000];
await mkdir('public/art', { recursive: true });
for (const file of (await readdir('art')).filter((f) => f.endsWith('.jpg'))) {
  const name = file.replace('.jpg', '');
  for (const w of widths) {
    const img = sharp(`art/${file}`).resize({ width: w });
    await img.clone().avif({ quality: 50 }).toFile(`public/art/${name}-${w}.avif`);
    await img.clone().webp({ quality: 72 }).toFile(`public/art/${name}-${w}.webp`);
  }
  console.log('done', name);
}
