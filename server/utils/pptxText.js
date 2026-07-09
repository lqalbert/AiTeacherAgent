import fs from 'node:fs'
import path from 'node:path'

/**
 * 从 .pptx 提取每页文本（pptx 为 zip，解析 slide XML 中的 a:t 节点）
 * @returns {Promise<string[]>} 按页序的幻灯片文本
 */
export async function extractPptxSlideTexts(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return []

  try {
    const { default: JSZip } = await import('jszip')
    const buf = fs.readFileSync(filePath)
    const zip = await JSZip.loadAsync(buf)

    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)/i)?.[1] || 0)
        const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0)
        return na - nb
      })

    const slides = []
    for (const file of slideFiles) {
      const xml = await zip.file(file).async('string')
      const parts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1])
      const text = parts.join('').replace(/\s+/g, ' ').trim()
      slides.push(text)
    }
    return slides
  } catch (err) {
    console.warn('[pptxText] 解析失败:', path.basename(filePath), err.message)
    return []
  }
}

export function resolvePptxFilePath(session, rootDir) {
  if (!session?.ppt_path) return null
  const rel = String(session.ppt_path).replace(/^\//, '')
  const abs = path.join(rootDir, rel)
  return fs.existsSync(abs) ? abs : null
}
