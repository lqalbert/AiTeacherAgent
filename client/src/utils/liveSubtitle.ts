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

const CN_DIGIT_MAP: Record<string, string> = {
  零: '0',
  〇: '0',
  一: '1',
  二: '2',
  两: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
}

/** 去掉口头犹豫/填充语气词（呃、嗯 等），保留正常教学用语 */
export function stripSpeechFillers(text: string): string {
  let s = String(text || '')

  // 犹豫音、拖音
  s = s.replace(/(呃|嗯|唔|欸|诶|噢|喔|咦|哟|嘿)+/g, '')
  // 单独的「啊」填充；保留「吗/呢/吧」
  s = s.replace(/啊+/g, '')
  // 作停顿用的「那个/这个/就是说」（后接标点或结尾）
  s = s.replace(/(^|[，。、；：\s])(就是说|怎么说|那个|这个)(?=[，。、；：\s]|$)/g, '$1')
  // 句首口头禅（长词在前；「那个/这个」仅当后接标点，避免误删「那个同学」）
  s = s.replace(/^(就是说|所以说|怎么说|然后|就是)+/g, '')
  s = s.replace(/^(那个|这个)(?=[，。、；：\s]|$)/g, '')
  // 重复口头禅
  s = s.replace(/(?:那个|这个){2,}/g, '')

  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/([，。！？、；：,.!?]){2,}/g, '$1')
  s = s.replace(/^[，、；：,]+/, '').trim()
  // 再清一次句首口头禅（删标点后可能露出）
  s = s.replace(/^(就是说|所以说|怎么说|然后|就是)+/g, '')
  s = s.replace(/^(那个|这个)(?=[，。、；：\s]|$)/g, '').trim()
  return s
}

/** @deprecated 使用 stripSpeechFillers */
export function stripLeadingFillers(text: string): string {
  return stripSpeechFillers(text)
}

/** 字幕展示清洗：先去语气填充词，再去标点（保留标点时更能识别「那个，就是说」） */
export function cleanSubtitleDisplay(text: string): string {
  return stripSubtitlePunctuation(stripSpeechFillers(text))
}

/**
 * 直播攒句用：去语气词，暂保留标点以便按句切分；上屏前会再去掉标点。
 */
export function formatLiveSubtitleSentence(text: string): string {
  let s = stripSpeechFillers(String(text || ''))
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
  s = s.replace(/^[，、；：,]+/, '').trim()
  s = s.replace(/([，。！？、；：,.!?…]){2,}/g, '$1')
  return s
}

const SENTENCE_END_RE = /[。！？!?…]/

/** 是否像一句已经说完的完整句 */
export function looksLikeCompleteSentence(text: string): boolean {
  const s = formatLiveSubtitleSentence(text)
  if (!s) return false
  if (SENTENCE_END_RE.test(s.slice(-1))) return true
  // 无标点时：足够长且以语气助词/收束感结尾，仍可视为一句
  if (s.length >= 12 && /[了的呢吧吗啊噢喔]$/.test(s)) return true
  return false
}

/**
 * 从文本中拆出已完成的句子，余下未完片段留在 rest
 */
export function extractCompleteSentences(text: string): { sentences: string[]; rest: string } {
  const s = formatLiveSubtitleSentence(text)
  if (!s) return { sentences: [], rest: '' }

  const sentences: string[] = []
  let buf = ''
  for (const ch of s) {
    buf += ch
    if (SENTENCE_END_RE.test(ch)) {
      const t = buf.trim()
      if (t) sentences.push(t)
      buf = ''
    }
  }
  return { sentences, rest: buf.trim() }
}

/**
 * 归一化后再比较：数字中英文、语气词、大小写差异不视为不同句
 */
export function normalizeSubtitleCompare(text: string): string {
  let s = cleanSubtitleDisplay(text).toLowerCase()
  s = s.replace(/[零〇一二两三四五六七八九]/g, (ch) => CN_DIGIT_MAP[ch] || ch)
  // 「十年」等暂保留「十」；单独「十」与「10」弱对等
  s = s.replace(/十/g, '10')
  return s
}

function longestCommonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return i
}

/** 最长公共子串长度（短句优先，用于识别中段重叠复读） */
function longestCommonSubstringLen(a: string, b: string): number {
  if (!a || !b) return 0
  let shorter = a
  let longer = b
  if (a.length > b.length) {
    shorter = b
    longer = a
  }
  if (longer.includes(shorter)) return shorter.length
  const minKeep = Math.max(4, Math.ceil(shorter.length * 0.55))
  for (let len = shorter.length - 1; len >= minKeep; len -= 1) {
    for (let i = 0; i + len <= shorter.length; i += 1) {
      if (longer.includes(shorter.slice(i, i + len))) return len
    }
  }
  return 0
}

/** A 尾与 B 头的重叠长度（半句复读粘连） */
function suffixPrefixOverlap(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  if (max < 4) return 0
  for (let len = max; len >= 4; len -= 1) {
    if (a.slice(-len) === b.slice(0, len)) return len
  }
  return 0
}

/**
 * 判断两句是否为同一句的 ASR 递进/重复结果
 * （同学们→同学们上课；近五年↔近5年；整句重复；中段重叠复读；尾部微改）
 */
export function isProgressiveUtterance(prev: string, next: string): boolean {
  const a = normalizeSubtitleCompare(prev)
  const b = normalizeSubtitleCompare(next)
  if (!a || !b) return false
  if (a === b) return true
  if (b.startsWith(a) || a.startsWith(b)) return true

  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length < 4) return false

  if (longer.includes(shorter)) {
    const idx = longer.indexOf(shorter)
    if (idx >= 0 && idx <= 4) return true
  }

  const lcp = longestCommonPrefixLen(a, b)
  const minLen = Math.min(a.length, b.length)
  const maxLen = Math.max(a.length, b.length)

  if (minLen >= 6 && lcp >= minLen * 0.8 && maxLen - minLen <= 24) return true
  if (minLen >= 12 && lcp >= minLen * 0.72 && maxLen - lcp <= Math.max(14, Math.floor(minLen * 0.28))) {
    return true
  }

  const lcs = longestCommonSubstringLen(a, b)
  if (shorter.length >= 8 && lcs >= shorter.length * 0.72) return true
  if (shorter.length >= 16 && lcs >= shorter.length * 0.58) return true

  const ov = suffixPrefixOverlap(a, b)
  if (ov >= 8 && ov >= minLen * 0.32) return true
  if (ov >= 12 && ov >= minLen * 0.25) return true

  return false
}

/**
 * 递进句取更完整的一版。
 * 优先句末完整（有句号等）；再比归一化长度；接近时取 next。
 */
export function pickProgressiveText(prev: string, next: string): string {
  const a = String(prev || '').trim()
  const b = String(next || '').trim()
  if (!a) return b
  if (!b) return a

  const na = normalizeSubtitleCompare(a)
  const nb = normalizeSubtitleCompare(b)
  if (na === nb) return b.length >= a.length ? b : a

  const aComplete = /[。！？；.!?]$/.test(a)
  const bComplete = /[。！？；.!?]$/.test(b)
  if (bComplete && !aComplete) return b
  if (aComplete && !bComplete) return a

  if (nb.startsWith(na)) return b
  if (na.startsWith(nb)) return a

  const ov = suffixPrefixOverlap(na, nb)
  if (ov >= 8) {
    return nb.length >= na.length ? b : a
  }

  if (nb.length > na.length) return b
  if (na.length > nb.length) return a
  return b.length >= a.length ? b : a
}

/** 从原文角度挑选更完整的递进结果（保留标点，供落库/报告拼接） */
export function pickProgressiveOriginal(prev: string, next: string): string {
  if (!isProgressiveUtterance(prev, next)) return next
  return pickProgressiveText(prev, next)
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
  const clean = cleanSubtitleDisplay(text)
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
