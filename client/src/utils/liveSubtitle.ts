/** 说话人字幕配色（0=无标签） */
export const SPEAKER_COLORS = [
  '',
  '#ffd666',
  '#95de64',
  '#69c0ff',
  '#ff9c6e',
  '#b37feb',
  '#ff85c0',
]

export function speakerLabel(speaker: number): string {
  if (!speaker || speaker <= 0) return ''
  return `说话人${speaker}`
}

const PUNCTUATION_RE =
  /[。，、；：？！…—·．,.!?;:'"()（）【】［］《》「」『』[\]{}<>～~\-_/\\|@#$%^&*+=`]/g

/** 直播字幕展示：去掉标点；英文保留单词间空格，中文去除字间空格 */
export function stripSubtitlePunctuation(text: string): string {
  let result = text
    .replace(PUNCTUATION_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  result = result.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
  return result
}

function isLatinDominant(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) || []).length
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  return latin > cjk
}

function splitLatinSentences(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  if (words.join(' ').length <= maxChars) return [words.join(' ')]

  const parts: string[] = []
  let chunk: string[] = []
  let len = 0

  for (const word of words) {
    const add = chunk.length === 0 ? word.length : word.length + 1
    if (len + add > maxChars && chunk.length > 0) {
      parts.push(chunk.join(' '))
      chunk = [word]
      len = word.length
    } else {
      chunk.push(word)
      len += add
    }
  }
  if (chunk.length) parts.push(chunk.join(' '))
  return parts.filter(Boolean)
}

/** 半屏宽度下每行约 20 字，保证完整短句且不过长 */
export const MAX_SENTENCE_CHARS = 20
export const MIN_SENTENCE_CHARS = 6

const SENTENCE_BREAK_CHARS = [
  '的', '了', '是', '在', '和', '与', '就', '也', '都', '着', '过',
  '把', '被', '让', '给', '这', '那', '而', '但', '因', '所', '以',
  '于', '对', '从', '向', '来', '去', '会', '能', '可', '要', '还',
  '又', '已', '将', '等', '及', '上', '下', '中', '内', '外', '后', '前',
  '吗', '呢', '吧', '啊',
]

/**
 * 将识别结果拆成完整有意义的短句（每句不超过 maxChars）。
 */
export function splitDisplaySentences(
  text: string,
  maxChars = MAX_SENTENCE_CHARS,
  minChars = MIN_SENTENCE_CHARS,
): string[] {
  const clean = stripSubtitlePunctuation(text)
  if (!clean) return []
  if (isLatinDominant(clean)) {
    return splitLatinSentences(clean, maxChars)
  }
  if (clean.length <= maxChars) return [clean]

  const parts: string[] = []
  let rest = clean

  while (rest.length > maxChars) {
    const searchEnd = Math.min(maxChars, rest.length - minChars)
    const searchStart = Math.max(minChars, maxChars - 8)
    let cut = -1

    for (let i = searchEnd; i >= searchStart; i--) {
      if (SENTENCE_BREAK_CHARS.includes(rest[i - 1])) {
        cut = i
        break
      }
    }

    if (cut < 0) cut = maxChars
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }

  if (rest) parts.push(rest)

  if (parts.length > 1 && parts[parts.length - 1].length < minChars) {
    parts[parts.length - 2] += parts.pop()
  }

  return parts.filter(Boolean)
}
