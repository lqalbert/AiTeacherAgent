import { chatCompletion, hasAiCredentials, parseJsonSafe } from './chat.js'

const ENABLED = process.env.ASR_AI_POLISH !== 'false'
const TIMEOUT_MS = Number(process.env.ASR_AI_POLISH_TIMEOUT_MS) || 2500
const HOTWORDS = process.env.ASR_HOTWORDS || ''

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

/**
 * 用 LLM 校对 ASR 口语转写：同音错字、学科术语、英文拼写等。
 * @returns {{ text: string, changed: boolean }}
 */
export async function polishTranscript(rawText, context = {}) {
  const text = String(rawText || '').trim()
  if (!text || text.length < 2) return { text, changed: false }
  if (!isTranscriptPolishEnabled()) return { text, changed: false }

  const sessionTitle = context.sessionTitle || '课堂'
  const slideIndex = Number.isInteger(context.slideIndex) ? context.slideIndex : null
  const recent = String(context.recentTranscript || '').slice(-400)
  const hotwords = context.hotwords || HOTWORDS

  const prompt = `你是 K12/中学课堂的「语音转写校对助手」。下面是一段实时 ASR 转写片段，请修正明显错误，使其适合作为课堂字幕。

课程：${sessionTitle}
${slideIndex != null ? `当前 PPT 第 ${slideIndex + 1} 页` : ''}
${hotwords ? `学科热词参考：${hotwords}` : ''}
${recent ? `上文（已校对）：${recent}` : ''}

待校对 ASR 原文：
${text}

规则：
1. 只修正同音错字、术语误写、英文拼读误转（如「E撇S」→「's」仅在明显应为所有格时修正）
2. 保持口语化，不扩写、不删改原意，不添加原文没有的内容
3. 保留说话人语气词（嗯、啊）除非明显是 ASR 噪声
4. 若原文已准确，原样返回
5. text 字段不要加标点（字幕展示会去掉标点）

严格返回 JSON：{"text":"校对后文本","changed":true或false}`

  const content = await withTimeout(
    chatCompletion(
      [
        {
          role: 'system',
          content: '你是语音识别后处理专家，输出必须是合法 JSON，text 为单行字符串。',
        },
        { role: 'user', content: prompt },
      ],
      { jsonMode: true, temperature: 0.1 },
    ),
    TIMEOUT_MS,
  )

  const parsed = parseJsonSafe(content)
  const polished = String(parsed.text ?? text).trim() || text
  const changed = Boolean(parsed.changed) && polished !== text
  return { text: polished, changed }
}
