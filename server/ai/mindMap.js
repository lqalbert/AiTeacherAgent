import { countMindMapNodes, normalizeMindMap } from '../utils/mindMap.js'

const PROVIDER = process.env.AI_PROVIDER || 'deepseek'

async function chatCompletion(messages, { jsonMode = true, temperature = 0.3 } = {}) {
  if (PROVIDER === 'dashscope') {
    return dashscopeChat(messages, { jsonMode, temperature })
  }
  return deepseekChat(messages, { jsonMode, temperature })
}

async function deepseekChat(messages, { jsonMode, temperature }) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY')

  const body = {
    model: 'deepseek-chat',
    messages,
    temperature,
  }
  if (jsonMode) body.response_format = { type: 'json_object' }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`DeepSeek API 错误: ${res.status} ${err}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function dashscopeChat(messages, { jsonMode, temperature }) {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error('未配置 DASHSCOPE_API_KEY')

  const body = {
    model: 'qwen-plus',
    input: { messages },
    parameters: { temperature },
  }
  if (jsonMode) {
    body.parameters.result_format = 'message'
    body.parameters.response_format = { type: 'json_object' }
  }

  const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`DashScope API 错误: ${res.status} ${err}`)
  }
  const data = await res.json()
  return data.output?.choices?.[0]?.message?.content || data.output?.text || ''
}

function parseJsonSafe(text) {
  const trimmed = text.trim()
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI 返回非 JSON 格式')
  return JSON.parse(jsonMatch[0])
}

function buildSlideOutline(evidence) {
  if (evidence?.pages?.length) {
    return evidence.pages
      .filter((p) => p.pptText || p.teacherText)
      .map((p) => {
        const lines = [`【第${p.index + 1}页·${p.status}】`]
        if (p.pptText) lines.push(`课件：${p.pptText.length > 300 ? `${p.pptText.slice(0, 300)}…` : p.pptText}`)
        if (p.teacherText) {
          const t = p.teacherText.length > 500 ? `${p.teacherText.slice(0, 500)}…` : p.teacherText
          lines.push(`讲解：${t}`)
        }
        return lines.join('\n')
      })
      .join('\n\n')
  }
  return ''
}

/**
 * 独立 AI 调用：基于课件+转写证据，生成知识结构思维导图
 */
export async function generateMindMap({ evidence, analysis }) {
  const slideOutline = buildSlideOutline(evidence)
  const transcriptExcerpt = evidence?.fullTranscript || '（无转写）'
  const pageEvidence = evidence?.pageEvidence || ''

  const prompt = `你是一位专业的「知识结构化」教研专家。请仔细阅读本节课**课件内容与教师口述证据**，提炼准确、可复习的思维导图。

## 硬性要求
1. **只写课堂上真正讲到的内容**（课件+口述），禁止依据标题猜测，禁止编造
2. 根节点 = 本节课实际讲授的核心主题（从证据归纳，8-16字）
3. 一级分支 4-6 个，按课堂实际讲授顺序组织
4. 叶子节点必须是具体知识点（定义、公式、规则、例句等），不要空泛标题
5. 课堂「重点」须在图中体现；「难点」可单独分支标注
6. label 不超过 24 字，优先使用教师原词

## 教研分析（辅助，以证据为准）
- 总结：${analysis?.summary || '（无）'}
- 重点：${(analysis?.keyPoints || []).join('；') || '（无）'}
- 难点：${(analysis?.difficultPoints || []).join('；') || '（无）'}
- 知识点：${(analysis?.knowledgeTags || []).join('、') || '（无）'}

## 按页证据（课件+讲解）
${pageEvidence || slideOutline || '（无）'}

## 完整转写
${transcriptExcerpt}

## 输出格式
严格返回 JSON，不要 markdown 代码块：
{
  "mindMap": {
    "label": "根节点主题",
    "children": [
      {
        "label": "一级模块",
        "children": [
          {
            "label": "二级要点",
            "children": [
              { "label": "三级细节" }
            ]
          }
        ]
      }
    ]
  }
}`

  const content = await chatCompletion(
    [
      {
        role: 'system',
        content:
          '你是知识结构专家。思维导图必须忠实于课堂转写，层级清晰、术语准确。只输出合法 JSON。',
      },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true, temperature: 0.2 },
  )

  const parsed = parseJsonSafe(content)
  const mindMap = normalizeMindMap(parsed.mindMap || parsed, analysis?.summary?.slice(0, 16) || '本节课')

  if ((mindMap.children?.length ?? 0) < 2) {
    throw new Error('AI 未能生成有效思维导图，请重试')
  }
  if (countMindMapNodes(mindMap) < 8) {
    throw new Error('思维导图内容过少，请重试或补充转写后再分析')
  }

  return mindMap
}
