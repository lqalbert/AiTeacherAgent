import { isProgressiveUtterance, pickProgressiveOriginal } from '../asr/subtitleText.js'

const CJK_RE = /[\u4e00-\u9fff]/
const LATIN_RE = /[A-Za-z0-9]/

/** 两段转写文本拼接时，英文等是否需要插入空格 */
export function needsSpaceBetween(prev, next) {
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
 * lookback: 除紧邻外，再向前看几句（隔一句复读）
 */
export function dedupeTranscriptParts(parts, lookback = 2) {
  const out = []
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
      // 若命中的不是最后一句，去掉中间被复读夹住的短碎片可选：保持简单，只合并命中项
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
export function joinTranscriptText(parts) {
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
    // 上一段已有句末标点或换行时，另起一行，便于转写阅读
    if (/[。！？；\n]$/.test(prev)) {
      result = `${prev}\n${next}`
      continue
    }
    result = needsSpaceBetween(prev, next) ? `${prev} ${next}` : prev + next
  }
  return result
}

export function joinTranscriptSegments(segments) {
  const texts = (segments || [])
    .filter((s) => s.is_final !== 0 && s.is_final !== false)
    .map((s) => s.text)
  return joinTranscriptText(texts)
}
