/**
 * Effro icon generator — single source of truth for the raster icon set.
 *
 * Renders every shipped PNG/ICO from the curved, mint-topped Effro mark so the
 * dock/taskbar icon, the browser-tab favicon, and the in-app Logo.jsx all share
 * one mark. Two treatments:
 *   - Dark "pitch" squircle tile  -> app icons (apple-touch, PWA icons, Tauri)
 *   - Bare ink+mint mark (transparent) -> favicon-16/32/48 + favicon.ico
 *
 * After running this, regenerate the full Tauri icon set from the new master:
 *     npx tauri icon src-tauri/icons/icon-source.png
 *
 * Usage (sharp/png-to-ico are NOT project deps — install them one-off):
 *     npm i sharp png-to-ico        # in this dir, or globally
 *     node scripts/generate-icons.mjs [repoRoot]
 *
 * repoRoot defaults to the parent of this script's directory.
 */
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PUB = join(ROOT, 'frontend', 'public')
const TAURI_ICONS = join(ROOT, 'src-tauri', 'icons')

// Dark squircle app-icon master (the version-controlled SVG source of truth).
const squircleSvg = readFileSync(join(TAURI_ICONS, 'icon-source.svg'))
const renderSquircle = (size) =>
  sharp(squircleSvg).resize(size, size).png().toBuffer()

// Bare mark for favicons: ink stem/bottom, mint top, transparent background.
// Mirrors favicon.svg's light-mode appearance (PNGs can't adapt to dark mode).
const bareMarkSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256" fill="none">
     <path d="M 78 22 Q 64 42, 50 50" stroke="#10B981" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M 78 78 Q 64 58, 50 50" stroke="#14130F" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M 22 50 L 50 50" stroke="#14130F" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
   </svg>`
)
const renderBare = (size) =>
  sharp(bareMarkSvg).resize(size, size).png().toBuffer()

async function main() {
  // App-icon squircle outputs (+ the 1024 master that `tauri icon` consumes).
  const squircleTargets = [
    [join(TAURI_ICONS, 'icon-source.png'), 1024],
    [join(PUB, 'icon-1024.png'), 1024],
    [join(PUB, 'icon-512.png'), 512],
    [join(PUB, 'icon-192.png'), 192],
    [join(PUB, 'apple-touch-icon.png'), 180],
  ]
  for (const [out, size] of squircleTargets) {
    writeFileSync(out, await renderSquircle(size))
    console.log('squircle', size.toString().padStart(4), '->', out)
  }

  // Bare-mark favicon PNGs, kept as buffers to assemble the .ico.
  const bareSizes = [48, 32, 16]
  const bare = {}
  for (const size of bareSizes) {
    bare[size] = await renderBare(size)
    writeFileSync(join(PUB, `favicon-${size}.png`), bare[size])
    console.log('bare    ', size.toString().padStart(4), '->', join(PUB, `favicon-${size}.png`))
  }

  // Multi-resolution favicon.ico (16 + 32 + 48).
  const ico = await pngToIco([bare[16], bare[32], bare[48]])
  writeFileSync(join(PUB, 'favicon.ico'), ico)
  console.log('ico      ->', join(PUB, 'favicon.ico'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
