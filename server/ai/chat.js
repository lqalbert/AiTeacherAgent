const PROVIDER = process.env.AI_PROVIDER || 'deepseek'

export function hasAiCredentials() {
  if (PROVIDER === 'dashscope') return Boolean(process.env.DASHSCOPE_API_KEY)
  return Boolean(process.env.DEEPSEEK_API_KEY)
}

export async function chatCompletion(messages, { jsonMode = true, temperature = 0.3 } = {}) {
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

export function parseJsonSafe(text) {
  const trimmed = text.trim()
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI 返回非 JSON 格式')
  return JSON.parse(jsonMatch[0])
}
