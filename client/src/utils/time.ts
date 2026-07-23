/** 将时间格式化为北京时间（Asia/Shanghai）展示 */

const BEIJING_TZ = 'Asia/Shanghai'

/**
 * SQLite `datetime('now')` 存的是 UTC 且无时区后缀；
 * ISO 字符串则按自身时区解析。统一输出北京时间。
 */
export function formatBeijingTime(value: string | number | Date | null | undefined): string {
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

function parseServerTime(value: string | number | Date): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)

  const raw = value.trim()
  if (!raw) return new Date(NaN)

  // 已带时区：按标准解析
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return new Date(raw)
  }

  // 无时区的 SQLite / 本地风格字符串，按 UTC 解释
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T')
  return new Date(`${iso}Z`)
}
