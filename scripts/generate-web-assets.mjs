import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const iconSvgPath = path.join(publicDir, 'icon.svg');
const workspaceScreenshotPath = path.join(rootDir, 'docs', 'privaguard-v6-workspace.png');

async function generateAssets() {
  const iconTargets = [
    { file: 'icon-192.png', size: 192 },
    { file: 'icon-512.png', size: 512 },
    { file: 'apple-touch-icon.png', size: 180 },
  ];

  for (const { file, size } of iconTargets) {
    const outPath = path.join(publicDir, file);
    await sharp(iconSvgPath, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 15, g: 123, b: 108, alpha: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log(`Generated public/${file} (${size}x${size})`);
  }

  const ogOutPath = path.join(publicDir, 'og-image.png');
  await sharp(workspaceScreenshotPath)
    .resize(1200, 630, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toFile(ogOutPath);
  console.log('Generated public/og-image.png (1200x630)');
}

generateAssets().catch((err) => {
  console.error('Failed to generate web assets:', err);
  process.exit(1);
});
