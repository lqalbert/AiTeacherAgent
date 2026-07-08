import { joinTranscriptSegments } from '../utils/transcriptText.js'
import { mindMapToMarkdownLines } from '../utils/mindMap.js'

export function buildMarkdownReport(report) {
  const { session, analysis, questions, transcript, currentRound } = report
  const lines = []

  lines.push(`# ${session.title}`)
  lines.push('')
  if (currentRound) {
    lines.push(`- 课次：第 ${currentRound.round_number} 节`)
    lines.push(`- 本节开始：${currentRound.started_at}`)
    if (currentRound.ended_at) lines.push(`- 本节结束：${currentRound.ended_at}`)
  } else {
    lines.push(`- 开始时间：${session.started_at}`)
    if (session.ended_at) lines.push(`- 结束时间：${session.ended_at}`)
  }
  lines.push('')

  if (analysis) {
    lines.push('## 课堂总结')
    lines.push('')
    lines.push(analysis.summary || '（暂无）')
    lines.push('')
    lines.push(`**整体难度**：${analysis.difficultyLevel}/5`)
    lines.push('')

    lines.push('## 重点')
    lines.push('')
    for (const p of analysis.keyPoints || []) {
      lines.push(`- ${p}`)
    }
    lines.push('')

    lines.push('## 难点')
    lines.push('')
    for (const p of analysis.difficultPoints || []) {
      lines.push(`- ${p}`)
    }
    lines.push('')

    if (analysis.knowledgeTags?.length) {
      lines.push('## 知识点')
      lines.push('')
      lines.push(analysis.knowledgeTags.map((t) => `\`${t}\``).join('、'))
      lines.push('')
    }

    if (analysis.mindMap?.children?.length) {
      lines.push('## 思维导图')
      lines.push('')
      lines.push(...mindMapToMarkdownLines(analysis.mindMap))
      lines.push('')
    }

    if (analysis.evaluation?.summary) {
      const ev = analysis.evaluation
      lines.push('## 课堂评价')
      lines.push('')
      lines.push(ev.summary)
      lines.push('')
      lines.push(`**教学综合评分**：${ev.score}/5`)
      lines.push('')
      if (ev.dimensions) {
        lines.push(
          '**分项评分**：' +
            [
              ev.dimensions.content != null && `教学内容 ${ev.dimensions.content}/5`,
              ev.dimensions.logic != null && `讲解逻辑 ${ev.dimensions.logic}/5`,
              ev.dimensions.focus != null && `重点把握 ${ev.dimensions.focus}/5`,
              ev.dimensions.expression != null && `语言表达 ${ev.dimensions.expression}/5`,
            ]
              .filter(Boolean)
              .join(' · '),
        )
        lines.push('')
      }
      if (ev.strengths?.length) {
        lines.push('### 教学亮点')
        lines.push('')
        for (const s of ev.strengths) lines.push(`- ${s}`)
        lines.push('')
      }
      if (ev.improvements?.length) {
        lines.push('### 改进建议')
        lines.push('')
        for (const s of ev.improvements) lines.push(`- ${s}`)
        lines.push('')
      }
    }
  }

  if (questions?.length) {
    lines.push('## 课后习题')
    lines.push('')
    questions.forEach((q, i) => {
      const typeLabel =
        q.questionType === 'choice' ? '选择题' : q.questionType === 'blank' ? '填空题' : '简答题'
      lines.push(`### 第 ${i + 1} 题（${typeLabel}，难度 ${q.difficulty}/5）`)
      lines.push('')
      lines.push(q.stem)
      lines.push('')
      if (q.options) {
        for (const [k, v] of Object.entries(q.options)) {
          lines.push(`${k}. ${v}`)
        }
        lines.push('')
      }
      lines.push(`**答案**：${q.answer}`)
      if (q.explanation) {
        lines.push('')
        lines.push(`**解析**：${q.explanation}`)
      }
      lines.push('')
    })
  }

  const finalText = joinTranscriptSegments(transcript || [])
  if (finalText) {
    lines.push('## 完整转写记录')
    lines.push('')
    lines.push(finalText)
    lines.push('')
  }

  return lines.join('\n')
}
