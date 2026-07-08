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

/** 将多段转写文本合并为可读段落（英文保留单词间空格，中文无空格） */
export function joinTranscriptText(parts: Array<string | null | undefined>): string {
  let result = ''
  for (const raw of parts) {
    const text = String(raw ?? '').trim()
    if (!text) continue
    if (!result) {
      result = text
      continue
    }
    result = needsSpaceBetween(result, text) ? `${result} ${text}` : result + text
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
