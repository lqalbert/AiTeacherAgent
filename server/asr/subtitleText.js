const PUNCTUATION_RE =
  /[。，、；：？！…—·．,.!?;:'"()（）【】［］《》「」『』[\]{}<>～~\-_/\\|@#$%^&*+=`]/g

const CN_DIGIT_MAP = {
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

/** 直播字幕展示：去掉标点；英文保留单词间空格，中文去除字间空格 */
export function stripSubtitlePunctuation(text) {
  let result = String(text || '')
    .replace(PUNCTUATION_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  result = result.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
  return result
}

export function stripSpeechFillers(text) {
  let s = String(text || '')

  s = s.replace(/(呃|嗯|唔|欸|诶|噢|喔|咦|哟|嘿)+/g, '')
  s = s.replace(/啊+/g, '')
  s = s.replace(/(^|[，。、；：\s])(就是说|怎么说|那个|这个)(?=[，。、；：\s]|$)/g, '$1')
  s = s.replace(/^(就是说|所以说|怎么说|然后|就是)+/g, '')
  s = s.replace(/^(那个|这个)(?=[，。、；：\s]|$)/g, '')
  s = s.replace(/(?:那个|这个){2,}/g, '')

  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/([，。！？、；：,.!?]){2,}/g, '$1')
  s = s.replace(/^[，、；：,]+/, '').trim()
  s = s.replace(/^(就是说|所以说|怎么说|然后|就是)+/g, '')
  s = s.replace(/^(那个|这个)(?=[，。、；：\s]|$)/g, '').trim()
  return s
}

/** @deprecated 使用 stripSpeechFillers */
export function stripLeadingFillers(text) {
  return stripSpeechFillers(text)
}

export function cleanSubtitleDisplay(text) {
  return stripSubtitlePunctuation(stripSpeechFillers(text))
}

export function normalizeSubtitleCompare(text) {
  let s = cleanSubtitleDisplay(text).toLowerCase()
  s = s.replace(/[零〇一二两三四五六七八九]/g, (ch) => CN_DIGIT_MAP[ch] || ch)
  s = s.replace(/十/g, '10')
  return s
}

function longestCommonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return i
}

export function isProgressiveUtterance(prev, next) {
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
    if (idx >= 0 && idx <= 2) return true
  }

  const lcp = longestCommonPrefixLen(a, b)
  const minLen = Math.min(a.length, b.length)
  const maxLen = Math.max(a.length, b.length)
  if (minLen >= 6 && lcp >= minLen * 0.8 && maxLen - minLen <= 16) return true
  if (minLen >= 8 && lcp >= minLen * 0.7 && maxLen - lcp <= 10) return true

  return false
}

export function pickProgressiveText(prev, next) {
  const a = cleanSubtitleDisplay(prev)
  const b = cleanSubtitleDisplay(next)
  if (!a) return b
  if (!b) return a

  const na = normalizeSubtitleCompare(a)
  const nb = normalizeSubtitleCompare(b)
  if (nb.startsWith(na) || nb.length > na.length) return b.length >= a.length ? b : a
  if (na.startsWith(nb)) return a.length >= b.length ? a : b
  return b.length >= a.length ? b : a
}
