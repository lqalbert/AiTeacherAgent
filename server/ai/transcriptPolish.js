import { chatCompletion, hasAiCredentials, parseJsonSafe } from './chat.js'
import { stripSpeechFillers } from '../asr/subtitleText.js'

const ENABLED = process.env.ASR_AI_POLISH !== 'false'
const TIMEOUT_MS = Number(process.env.ASR_AI_POLISH_TIMEOUT_MS) || 4000
const HOTWORDS = process.env.ASR_HOTWORDS || ''
const DIALECT_HINT = process.env.ASR_DIALECT_HINT || '普通话与四川方言混合'

export function isTranscriptPolishEnabled() {
  return ENABLED && hasAiCredentials()
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('AI 校对超时')), ms)
    }),
  ])
}

function clip(text, max = 600) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

/**
 * 用 LLM 结合课件与上文校对 ASR 转写：纠错 + 补全标点/分段。
 * @returns {{ text: string, changed: boolean }}
 */
export async function polishTranscript(rawText, context = {}) {
  const text = String(rawText || '').trim()
  if (!text || text.length < 2) return { text, changed: false }
  if (!isTranscriptPolishEnabled()) return { text, changed: false }

  const sessionTitle = context.sessionTitle || '课堂'
  const slideIndex = Number.isInteger(context.slideIndex) ? context.slideIndex : null
  const slideText = clip(context.slideText || '', 800)
  const nearbySlides = String(context.nearbySlides || '').trim()
  const recent = String(context.recentTranscript || '').slice(-500)
  const hotwords = context.hotwords || HOTWORDS

  const coursewareBlock = [
    slideIndex != null ? `当前 PPT 第 ${slideIndex + 1} 页` : '',
    slideText ? `当前页课件原文：${slideText}` : '当前页课件原文：（无文字或未解析）',
    nearbySlides ? `相邻页课件参考：\n${nearbySlides}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `你是中职/课堂场景的「语音转写校对助手」。ASR 原文通常没有标点、没有分段，且可能有同音错字。请结合课件与上文，输出适合作为「转写记录」落库的文本。

课程：${sessionTitle}
语言环境：${DIALECT_HINT}（请把明显误听还原为教师真实要表达的教学用语）
${hotwords ? `学科热词参考：${hotwords}` : ''}

## 课件上下文（优先用于术语与专有名词校对）
${coursewareBlock || '（无课件上下文）'}

## 上文转写（已校对，供连贯断句）
${recent || '（无）'}

## 待校对 ASR 原文
${text}

## 规则
1. **依据课件与上文**：优先用课件中的术语、专有名词、流程名称纠正同音错字与误听；不要编造原文/课件都未出现的知识点
2. **必须补全标点**：为可读转写添加中文标点（，。？！、；：以及必要的引号、书名号），按语义断句，避免一长串无标点
3. **适度分段**：若本段明显换话题、换步骤或语义单元较长，用换行符 \\n 分段；不要把每个短句都单独成行
4. **去掉语气填充词**：删除口头犹豫与填充（呃、嗯、啊、噢、唔、欸，以及句首「那个/这个/就是说」等），不要保留
5. **不扩写、不删改原意**：不添加教师没说的知识点；不要删掉有意义的教学内容
6. **英文与数字**：按课件规范写法（大小写、单位）；不要把正确内容改错
7. 若原文已准确且已有合理标点、无语气填充，可仅微调后返回

严格返回 JSON：{"text":"校对后文本（含标点，可含换行，不含语气填充词）","changed":true或false}`

  const content = await withTimeout(
    chatCompletion(
      [
        {
          role: 'system',
          content:
            '你是课堂语音转写后处理专家。必须结合课件上下文纠错，并为无标点原文补全标点与必要分段。只输出合法 JSON。',
        },
        { role: 'user', content: prompt },
      ],
      { jsonMode: true, temperature: 0.1 },
    ),
    TIMEOUT_MS,
  )

  const parsed = parseJsonSafe(content)
  let polished = String(parsed.text ?? text).trim() || text
  // 统一换行，去掉首尾多余空行，并强制去掉语气填充词
  polished = stripSpeechFillers(
    polished
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )

  const changed = polished !== text
  return { text: polished, changed: Boolean(parsed.changed) || changed }
}
