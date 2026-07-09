import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractPptxSlideTexts, resolvePptxFilePath } from '../utils/pptxText.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const TRANSCRIPT_PAGE_LIMIT = 1200
const TRANSCRIPT_TOTAL_LIMIT = 16000

function clip(text, max) {
  const s = String(text || '').trim()
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 构建「课件 + 教师口述」对齐证据，供 AI 分析使用（不依赖课程标题）
 */
export async function buildLessonEvidence({
  session,
  transcript,
  transcriptBySlide,
  slideEvents = [],
  roundLabel = '',
}) {
  const pptPath = resolvePptxFilePath(session, ROOT)
  const pptSlides = pptPath ? await extractPptxSlideTexts(pptPath) : []

  const visitedSlides = new Set(slideEvents.map((e) => e.slide_index ?? 0))
  const spokenSlides = new Set(
    Object.entries(transcriptBySlide || {})
      .filter(([, text]) => String(text).trim())
      .map(([slide]) => Number(slide)),
  )

  const maxSlide = Math.max(
    pptSlides.length - 1,
    visitedSlides.size ? Math.max(...visitedSlides) : 0,
    spokenSlides.size ? Math.max(...spokenSlides) : 0,
    0,
  )

  const pages = []
  for (let i = 0; i <= maxSlide; i++) {
    const pptText = pptSlides[i] || ''
    const teacherText = transcriptBySlide?.[i] || transcriptBySlide?.[String(i)] || ''
    const visited = visitedSlides.has(i)
    const spoken = Boolean(String(teacherText).trim())

    let status = '未翻到'
    if (visited && spoken) status = '已讲解'
    else if (visited && !spoken) status = '翻过页但未口述'
    else if (!visited && spoken) status = '有口述记录（翻页可能不完整）'

    pages.push({ index: i, pptText, teacherText, visited, spoken, status })
  }

  const pageEvidence = pages
    .filter((p) => p.pptText || p.teacherText || p.visited)
    .map((p) => {
      const lines = [`=== 第 ${p.index + 1} 页（${p.status}）===`]
      if (p.pptText) lines.push(`【课件内容】${clip(p.pptText, 800)}`)
      else lines.push('【课件内容】（未能提取文字，可能以图片为主）')
      if (p.teacherText) lines.push(`【教师讲解】${clip(p.teacherText, TRANSCRIPT_PAGE_LIMIT)}`)
      else lines.push('【教师讲解】（本页无口述记录）')
      return lines.join('\n')
    })
    .join('\n\n')

  const fullTranscript =
    (transcript || '').length > TRANSCRIPT_TOTAL_LIMIT
      ? `${transcript.slice(0, TRANSCRIPT_TOTAL_LIMIT)}\n\n（转写已截断，请优先依据按页证据）`
      : transcript || '（无转写）'

  const taughtPages = pages.filter((p) => p.spoken).length
  const pptPages = pptSlides.filter((t) => t.trim()).length

  return {
    pptSlides,
    pages,
    pageEvidence: pageEvidence || '（无按页证据，仅有完整转写）',
    fullTranscript,
    stats: {
      pptPageCount: pptSlides.length,
      pptTextPages: pptPages,
      taughtPages,
      visitedPages: visitedSlides.size,
      transcriptChars: (transcript || '').length,
    },
    meta: {
      roundLabel,
      pptFilename: session?.ppt_filename || '',
      hasPpt: pptSlides.length > 0,
    },
  }
}
