/**
 * 评课亮点/改进建议：兼容旧版 string[] 与新版 { claim, page, quote }[]
 */
export function normalizeEvaluationPoints(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => {
      if (typeof item === 'string') {
        const claim = item.trim()
        return claim ? { claim, page: null, quote: null } : null
      }
      if (!item || typeof item !== 'object') return null
      const claim = String(item.claim || item.text || item.content || '').trim()
      if (!claim) return null
      const pageNum = Number(item.page)
      const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : null
      const quote = String(item.quote || item.evidence || '').trim().slice(0, 80) || null
      return { claim, page, quote }
    })
    .filter(Boolean)
}

/** 导出/展示用单行文本 */
export function formatEvaluationPoint(point) {
  const p = normalizeEvaluationPoints([point])[0]
  if (!p) return ''
  const bits = []
  if (p.page) bits.push(`第 ${p.page} 页`)
  if (p.quote) bits.push(`「${p.quote}」`)
  return bits.length ? `${p.claim}（证据：${bits.join(' · ')}）` : p.claim
}
