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

/** 直播上屏文案：去语气词，保留标点 */
export function formatLiveSubtitleSentence(text) {
  let s = stripSpeechFillers(String(text || ''))
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
  s = s.replace(/^[，、；：,]+/, '').trim()
  s = s.replace(/([，。！？、；：,.!?…]){2,}/g, '$1')
  return s
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

/** 最长公共子串长度（短句优先，用于识别中段重叠复读） */
function longestCommonSubstringLen(a, b) {
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
function suffixPrefixOverlap(a, b) {
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
export function isProgressiveUtterance(prev, next) {
  const a = normalizeSubtitleCompare(prev)
  const b = normalizeSubtitleCompare(next)
  if (!a || !b) return false
  if (a === b) return true
  if (b.startsWith(a) || a.startsWith(b)) return true

  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length < 4) return false

  // 短句整段嵌在长句靠前位置
  if (longer.includes(shorter)) {
    const idx = longer.indexOf(shorter)
    if (idx >= 0 && idx <= 4) return true
  }

  const lcp = longestCommonPrefixLen(a, b)
  const minLen = Math.min(a.length, b.length)
  const maxLen = Math.max(a.length, b.length)

  // 大部分前缀相同，后面多补了字
  if (minLen >= 6 && lcp >= minLen * 0.8 && maxLen - minLen <= 24) return true
  // 长句尾部微改（出错的地方 / 卡住的地方）
  if (minLen >= 12 && lcp >= minLen * 0.72 && maxLen - lcp <= Math.max(14, Math.floor(minLen * 0.28))) {
    return true
  }

  // 中段大段重叠（半句复读、列表续写）
  const lcs = longestCommonSubstringLen(a, b)
  if (shorter.length >= 8 && lcs >= shorter.length * 0.72) return true
  if (shorter.length >= 16 && lcs >= shorter.length * 0.58) return true

  // 上句尾巴 = 下句开头（粘连复读）
  const ov = suffixPrefixOverlap(a, b)
  if (ov >= 8 && ov >= minLen * 0.32) return true
  if (ov >= 12 && ov >= minLen * 0.25) return true

  return false
}

/**
 * 递进句取更完整的一版。
 * 优先句末完整（有句号等）；再比归一化长度；接近时取 next。
 */
export function pickProgressiveText(prev, next) {
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
    // 粘连复读：拼成更完整句（归一化重叠映射回原文较难，取更完整侧）
    return nb.length >= na.length ? b : a
  }

  if (nb.length > na.length) return b
  if (na.length > nb.length) return a
  return b.length >= a.length ? b : a
}

/** 从原文角度挑选更完整的递进结果（保留标点，供落库/报告拼接） */
export function pickProgressiveOriginal(prev, next) {
  if (!isProgressiveUtterance(prev, next)) return next
  return pickProgressiveText(prev, next)
}
