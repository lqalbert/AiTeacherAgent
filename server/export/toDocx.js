import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { joinTranscriptSegments } from '../utils/transcriptText.js'
import { mindMapToBulletItems } from '../utils/mindMap.js'

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { after: 200 } })
}

function body(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 24 })],
    spacing: { after: 120 },
  })
}

function bullet(text, level = 0) {
  return new Paragraph({
    text,
    bullet: { level },
    spacing: { after: 80 },
  })
}

export async function buildDocxBuffer(report) {
  const { session, analysis, questions, transcript } = report
  const children = []

  children.push(heading(session.title))
  children.push(body(`开始时间：${session.started_at}`))
  if (session.ended_at) children.push(body(`结束时间：${session.ended_at}`))

  if (analysis) {
    children.push(heading('课堂总结', HeadingLevel.HEADING_2))
    children.push(body(analysis.summary || '（暂无）'))
    children.push(body(`整体难度：${analysis.difficultyLevel}/5`))

    children.push(heading('重点', HeadingLevel.HEADING_2))
    for (const p of analysis.keyPoints || []) children.push(bullet(p))

    children.push(heading('难点', HeadingLevel.HEADING_2))
    for (const p of analysis.difficultPoints || []) children.push(bullet(p))

    if (analysis.knowledgeTags?.length) {
      children.push(heading('知识点', HeadingLevel.HEADING_2))
      children.push(body(analysis.knowledgeTags.join('、')))
    }

    if (analysis.mindMap?.children?.length) {
      children.push(heading('思维导图', HeadingLevel.HEADING_2))
      for (const item of mindMapToBulletItems(analysis.mindMap)) {
        children.push(bullet(item.text, item.level))
      }
    }

    if (analysis.evaluation?.summary) {
      const ev = analysis.evaluation
      children.push(heading('课堂评价', HeadingLevel.HEADING_2))
      children.push(body(ev.summary))
      children.push(body(`教学综合评分：${ev.score}/5`))
      if (ev.dimensions) {
        const parts = []
        if (ev.dimensions.content != null) parts.push(`教学内容 ${ev.dimensions.content}/5`)
        if (ev.dimensions.logic != null) parts.push(`讲解逻辑 ${ev.dimensions.logic}/5`)
        if (ev.dimensions.focus != null) parts.push(`重点把握 ${ev.dimensions.focus}/5`)
        if (ev.dimensions.expression != null) parts.push(`语言表达 ${ev.dimensions.expression}/5`)
        if (parts.length) children.push(body(`分项评分：${parts.join(' · ')}`))
      }
      if (ev.strengths?.length) {
        children.push(heading('教学亮点', HeadingLevel.HEADING_3))
        for (const s of ev.strengths) children.push(bullet(s))
      }
      if (ev.improvements?.length) {
        children.push(heading('改进建议', HeadingLevel.HEADING_3))
        for (const s of ev.improvements) children.push(bullet(s))
      }
    }
  }

  if (questions?.length) {
    children.push(heading('课后习题', HeadingLevel.HEADING_2))
    questions.forEach((q, i) => {
      const typeLabel =
        q.questionType === 'choice' ? '选择题' : q.questionType === 'blank' ? '填空题' : '简答题'
      children.push(heading(`第 ${i + 1} 题（${typeLabel}）`, HeadingLevel.HEADING_3))
      children.push(body(q.stem))
      if (q.options) {
        for (const [k, v] of Object.entries(q.options)) {
          children.push(body(`${k}. ${v}`))
        }
      }
      children.push(body(`答案：${q.answer}`))
      if (q.explanation) children.push(body(`解析：${q.explanation}`))
    })
  }

  const finalText = joinTranscriptSegments(transcript || [])
  if (finalText) {
    children.push(heading('完整转写记录', HeadingLevel.HEADING_2))
    children.push(body(finalText))
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}
