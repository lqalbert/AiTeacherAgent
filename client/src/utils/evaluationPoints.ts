import type { EvaluationPoint } from '../types'

/** 兼容旧版 string 与新版结构化证据点 */
export function normalizeEvaluationPoint(item: string | EvaluationPoint | null | undefined): EvaluationPoint | null {
  if (item == null) return null
  if (typeof item === 'string') {
    const claim = item.trim()
    return claim ? { claim, page: null, quote: null } : null
  }
  const claim = String(item.claim || '').trim()
  if (!claim) return null
  const pageNum = Number(item.page)
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : null
  const quote = String(item.quote || '').trim() || null
  return { claim, page, quote }
}

export function normalizeEvaluationPoints(
  list: Array<string | EvaluationPoint> | null | undefined,
): EvaluationPoint[] {
  if (!Array.isArray(list)) return []
  return list.map(normalizeEvaluationPoint).filter((p): p is EvaluationPoint => Boolean(p))
}
