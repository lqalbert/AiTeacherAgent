import { isProgressiveUtterance, pickProgressiveOriginal } from './liveSubtitle'

const CJK_RE = /[\u4e00-\u9fff]/
const LATIN_RE = /[A-Za-z0-9]/

/** 两段转写文本拼接时，英文等是否需要插入空格 */
export function needsSpaceBetween(prev: string, next: string): boolean {
  if (!prev || !next) return false
  const a = prev.slice(-1)
  const b = next[0]
  if (/\s/.test(a) || /\s/.test(b)) return false
  if (/^[,，.．!?;:'"')\]}]/.test(next)) return false
  if (/[-'']$/.test(prev)) return false

  const aCjk = CJK_RE.test(a)
  const bCjk = CJK_RE.test(b)
  if (aCjk && bCjk) return false

  const aLatin = LATIN_RE.test(a)
  const bLatin = LATIN_RE.test(b)
  if (aLatin && bLatin) return true
  if ((aLatin && bCjk) || (aCjk && bLatin)) return true

  return false
}

/**
 * 合并相邻递进/复读句段，保留更完整的一版（修复报告中重复段落）
 */
export function dedupeTranscriptParts(
  parts: Array<string | null | undefined>,
  lookback = 2,
): string[] {
  const out: string[] = []
  for (const raw of parts) {
    const text = String(raw ?? '')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n{3,}/g, '\n\n')
    if (!text) continue
    if (out.length === 0) {
      out.push(text)
      continue
    }

    let merged = false
    const from = Math.max(0, out.length - lookback)
    for (let i = out.length - 1; i >= from; i -= 1) {
      if (!isProgressiveUtterance(out[i], text)) continue
      out[i] = pickProgressiveOriginal(out[i], text)
      if (i < out.length - 1 && isProgressiveUtterance(out[i], out[out.length - 1])) {
        out[i] = pickProgressiveOriginal(out[i], out[out.length - 1])
        out.splice(i + 1)
      }
      merged = true
      break
    }
    if (!merged) out.push(text)
  }
  return out
}

/** 将多段转写文本合并为可读段落（保留标点与分段；英文保留单词间空格） */
export function joinTranscriptText(parts: Array<string | null | undefined>): string {
  const deduped = dedupeTranscriptParts(parts)
  let result = ''
  for (const text of deduped) {
    if (!text) continue
    if (!result) {
      result = text
      continue
    }
    const prev = result.replace(/\s+$/g, '')
    const next = text.replace(/^\s+/g, '')
    if (/[。！？；\n]$/.test(prev)) {
      result = `${prev}\n${next}`
      continue
    }
    result = needsSpaceBetween(prev, next) ? `${prev} ${next}` : prev + next
  }
  return result
}

export function joinTranscriptSegments(
  segments: Array<{ text: string; is_final?: number | boolean }>,
): string {
  const texts = segments
    .filter((s) => s.is_final !== 0 && s.is_final !== false)
    .map((s) => s.text)
  return joinTranscriptText(texts)
}
