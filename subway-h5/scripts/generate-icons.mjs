// 从 public/icons/icon.svg 生成各尺寸 PNG 图标（供 PWA manifest / iOS 使用）
// 依赖 sharp。运行: npm run icons

import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ICONS_DIR = resolve(__dirname, '../public/icons')

const TARGETS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.2 }, // maskable 留 20% 安全边距
  { file: 'apple-touch-icon.png', size: 180 }
]

async function main() {
  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.error('未安装 sharp，请先运行: npm install')
    process.exit(1)
  }
  const svg = await readFile(resolve(ICONS_DIR, 'icon.svg'))

  for (const t of TARGETS) {
    const padding = t.padding || 0
    const inner = Math.round(t.size * (1 - padding * 2))
    const offset = Math.round((t.size - inner) / 2)
    const pipeline = sharp(svg, { density: 384 })
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    const innerBuf = await pipeline.png().toBuffer()

    // 合成到带背景的画布（maskable 需要满铺背景）
    const bg = await sharp({
      create: {
        width: t.size,
        height: t.size,
        channels: 4,
        background: { r: 15, g: 17, b: 21, alpha: 1 }
      }
    }).png().toBuffer()

    await sharp(bg)
      .composite([{ input: innerBuf, left: offset, top: offset }])
      .png()
      .toFile(resolve(ICONS_DIR, t.file))

    console.log(`  ✓ ${t.file} (${t.size}x${t.size})`)
  }
  console.log('图标生成完成')
}

main().catch(e => { console.error(e); process.exit(1) })
