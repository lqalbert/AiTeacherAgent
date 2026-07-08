import { stripSubtitlePunctuation } from './liveSubtitle'

/** 将一句字幕拆成最多两行（电影字幕风格） */
export function wrapSubtitleLines(text: string, maxPerLine = 20): string[] {
  const clean = stripSubtitlePunctuation(text)
  if (!clean) return []
  if (clean.length <= maxPerLine) return [clean]

  const mid = Math.ceil(clean.length / 2)
  const breakChars = ['，', '、', '；', '：', ',', ' ', '的', '了', '是', '在']

  let breakAt = -1
  let bestDist = Infinity
  for (let i = 0; i < clean.length; i++) {
    if (!breakChars.includes(clean[i])) continue
    const dist = Math.abs(i - mid)
    if (dist < bestDist && i >= 4 && i < clean.length - 3) {
      bestDist = dist
      breakAt = i + 1
    }
  }

  if (breakAt < 0) breakAt = mid

  const line1 = clean.slice(0, breakAt).trim()
  const line2 = clean.slice(breakAt).trim()
  return [line1, line2].filter(Boolean).slice(0, 2)
}
