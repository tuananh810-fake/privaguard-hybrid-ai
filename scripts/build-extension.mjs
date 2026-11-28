import { build } from 'vite';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.resolve(ROOT, 'extension', 'dist');

async function bundleEntry(name, entryPath, format) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      minify: true,
      sourcemap: false,
      lib: {
        entry: path.resolve(ROOT, entryPath),
        name: `PrivaGuardExt_${name}`,
        formats: [format],
        fileName: () => `${name}.js`,
      },
      rolldownOptions: {
        output: {
          codeSplitting: false,
        },
      },
    },
  });
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUT_DIR, 'icons'), { recursive: true });

  await bundleEntry('content', 'extension/src/content.ts', 'iife');
  await bundleEntry('background', 'extension/src/background.ts', 'es');
  await bundleEntry('popup', 'extension/src/popup.ts', 'iife');
  await bundleEntry('offscreen', 'extension/src/offscreen.ts', 'es');

  await Promise.all([
    copyFile(path.join(ROOT, 'extension', 'manifest.json'), path.join(OUT_DIR, 'manifest.json')),
    copyFile(path.join(ROOT, 'extension', 'src', 'popup.html'), path.join(OUT_DIR, 'popup.html')),
    copyFile(path.join(ROOT, 'extension', 'src', 'offscreen.html'), path.join(OUT_DIR, 'offscreen.html')),
    copyFile(path.join(ROOT, 'extension', 'playground.html'), path.join(OUT_DIR, 'playground.html')),
    copyFile(path.join(ROOT, 'public', 'icon-192.png'), path.join(OUT_DIR, 'icons', 'icon-192.png')),
    copyFile(path.join(ROOT, 'public', 'icon-512.png'), path.join(OUT_DIR, 'icons', 'icon-512.png')),
    copyFile(
      path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'),
      path.join(OUT_DIR, 'pdf.worker.min.mjs')
    ),
  ]);

  console.log(`\nPrivaGuard Chrome Extension MV3 built cleanly -> ${OUT_DIR}`);
  console.log('Load unpacked in Chrome: chrome://extensions -> Developer mode -> Load unpacked -> extension/dist');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
