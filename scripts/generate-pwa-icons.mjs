/**
 * Génère les PNG PWA (192, 512, apple-touch 180) à partir d’un motif simple JLT.
 * Exécuter : npm run generate-pwa-icons
 */
import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'public')

function fillRect(png, x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (png.width * y + x) << 2
      png.data[idx] = r
      png.data[idx + 1] = g
      png.data[idx + 2] = b
      png.data[idx + 3] = a
    }
  }
}

function fillCircle(png, cx, cy, rad, r, g, b) {
  const r2 = rad * rad
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r2) {
        const idx = (png.width * y + x) << 2
        png.data[idx] = r
        png.data[idx + 1] = g
        png.data[idx + 2] = b
        png.data[idx + 3] = 255
      }
    }
  }
}

function writePng(png, outPath) {
  return new Promise((resolve, reject) => {
    png
      .pack()
      .pipe(fs.createWriteStream(outPath))
      .on('finish', resolve)
      .on('error', reject)
  })
}

async function makeIcon(size, outPath) {
  const png = new PNG({ width: size, height: size })
  fillRect(png, 0, 0, size, size, 8, 23, 56)
  const rad = Math.round(size * 0.32)
  fillCircle(png, size / 2, size / 2, rad, 245, 158, 11)
  await writePng(png, outPath)
  console.log('Wrote', outPath)
}

await makeIcon(192, join(publicDir, 'pwa-192.png'))
await makeIcon(512, join(publicDir, 'pwa-512.png'))
await makeIcon(180, join(publicDir, 'apple-touch-icon.png'))
