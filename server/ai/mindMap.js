import { countMindMapNodes, normalizeMindMap } from '../utils/mindMap.js'

const PROVIDER = process.env.AI_PROVIDER || 'deepseek'
const TRANSCRIPT_LIMIT = 12000

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

function buildSlideOutline(transcriptBySlide) {
  return Object.entries(transcriptBySlide || {})
    .map(([slide, text]) => {
      const page = Number(slide) + 1
      const content = String(text || '').trim()
      if (!content) return null
      return `【第${page}页】${content.length > 600 ? `${content.slice(0, 600)}…` : content}`
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 独立 AI 调用：基于转写 + 课堂分析，生成知识结构思维导图
 */
export async function generateMindMap({ title, transcript, transcriptBySlide, analysis }) {
  const slideOutline = buildSlideOutline(transcriptBySlide)
  const transcriptExcerpt =
    (transcript || '').length > TRANSCRIPT_LIMIT
      ? `${transcript.slice(0, TRANSCRIPT_LIMIT)}\n\n（转写已截断，请结合按页大纲理解完整内容）`
      : transcript || '（无转写）'

  const prompt = `你是一位专业的「知识结构化」教研专家。请仔细阅读本节课转写与教研分析，提炼**准确、完整、可复习**的思维导图。

## 任务目标
将本节课讲授的知识组织成树形思维导图，帮助学生一眼看清「讲了什么、怎么分类、关键细节是什么」。

## 硬性要求
1. **只写课堂里真正讲到的内容**，禁止编造转写中未出现的概念、公式或例子
2. 根节点 label = 本节课核心主题（8-16字，准确概括）
3. 一级分支 4-6 个：按课堂讲授顺序或知识模块划分（如「概念与定义」「类型与分类」「用法与规则」「例题与技巧」「易错点与对比」等，按学科选用合适模块名）
4. 每个一级分支下 2-5 个二级节点；重要分支可再展开三级、四级，但整图最多 4 层
5. 叶子节点必须是**具体知识点**（定义要点、公式、规则、例句、步骤、对比项等），不要空泛标题
6. 课堂「重点」必须在图中对应分支体现；「难点」可单独设分支或在相关节点下标注
7. 每个 label 简洁精准，不超过 24 字；优先使用转写中的原词、原表述
8. 节点总数（含根节点）建议 15-35 个，信息密度适中

## 课程信息
标题：${title}

## 教研分析（辅助定位重点，仍以转写为准）
- 总结：${analysis?.summary || '（无）'}
- 重点：${(analysis?.keyPoints || []).join('；') || '（无）'}
- 难点：${(analysis?.difficultPoints || []).join('；') || '（无）'}
- 知识点标签：${(analysis?.knowledgeTags || []).join('、') || '（无）'}

## 按页转写大纲
${slideOutline || '（无按页分段）'}

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
  const mindMap = normalizeMindMap(parsed.mindMap || parsed, title)

  if ((mindMap.children?.length ?? 0) < 2) {
    throw new Error('AI 未能生成有效思维导图，请重试')
  }
  if (countMindMapNodes(mindMap) < 8) {
    throw new Error('思维导图内容过少，请重试或补充转写后再分析')
  }

  return mindMap
}
