/** 将服务端时间（多为 SQLite UTC）格式化为北京时间字符串 */

const BEIJING_TZ = 'Asia/Shanghai'

export function formatBeijingTime(value) {
  if (value == null || value === '') return ''
  const date = parseServerTime(value)
  if (!date || Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function parseServerTime(value) {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)

  const raw = String(value).trim()
  if (!raw) return new Date(NaN)

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return new Date(raw)
  }

  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T')
  return new Date(`${iso}Z`)
}
