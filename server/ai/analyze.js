import { generateMindMap } from './mindMap.js'
import { chatCompletion, parseJsonSafe } from './chat.js'

async function analyzeLesson({ title, transcript, transcriptBySlide }) {
  const slideSummary = Object.entries(transcriptBySlide || {})
    .map(([slide, text]) => `第${Number(slide) + 1}页: ${text}`)
    .join('\n')

  const prompt = `你是一位资深教研员。请根据以下课堂录音转写内容，分析本节课的重难点并撰写总结。

课程标题：${title}

完整转写：
${transcript || '（无转写内容）'}

按页分段（如有）：
${slideSummary || '（无分段）'}

请严格以 JSON 格式返回，字段如下：
{
  "keyPoints": ["重点1", "重点2"],
  "difficultPoints": ["难点1"],
  "summary": "200-400字课堂总结",
  "difficultyLevel": 3,
  "knowledgeTags": ["知识点1", "知识点2"]
}

difficultyLevel 为 1-5 整数，表示本节课整体难度（1最简单，5最难）。`

  const content = await chatCompletion(
    [
      { role: 'system', content: '你是教育领域专家，输出必须是合法 JSON。' },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true },
  )

  const parsed = parseJsonSafe(content)
  return {
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    difficultPoints: Array.isArray(parsed.difficultPoints) ? parsed.difficultPoints : [],
    summary: String(parsed.summary || ''),
    difficultyLevel: Math.min(5, Math.max(1, Number(parsed.difficultyLevel) || 3)),
    knowledgeTags: Array.isArray(parsed.knowledgeTags) ? parsed.knowledgeTags : [],
  }
}

/** AI 生成本节课教学评价（基于转写与分析结果） */
export async function generateLessonEvaluation({ title, transcript, transcriptBySlide, analysis }) {
  const slideSummary = Object.entries(transcriptBySlide || {})
    .map(([slide, text]) => `第${Number(slide) + 1}页: ${text.slice(0, 200)}`)
    .join('\n')

  const prompt = `你是一位经验丰富的教学督导。请仅根据以下课堂转写记录与教研分析，对本节课的教学表现进行客观、专业的评价。

课程标题：${title}

课堂总结：${analysis?.summary || '（无）'}
重点：${(analysis?.keyPoints || []).join('；') || '（无）'}
难点：${(analysis?.difficultPoints || []).join('；') || '（无）'}
知识点：${(analysis?.knowledgeTags || []).join('、') || '（无）'}

按页转写摘要：
${slideSummary || '（无）'}

完整转写（节选）：
${(transcript || '').slice(0, 8000)}

请从教学内容、讲解逻辑、重点把握、语言表达与课堂节奏等维度综合评价，并给出可操作的改进建议。
评价须基于转写事实，不要编造课堂上未出现的内容；语气专业、建设性，适合教师自我复盘。

严格返回 JSON：
{
  "summary": "200-400字综合评价",
  "score": 4,
  "strengths": ["教学亮点1", "教学亮点2"],
  "improvements": ["改进建议1", "改进建议2"],
  "dimensions": {
    "content": 4,
    "logic": 4,
    "focus": 4,
    "expression": 4
  }
}

score 与 dimensions 各维度均为 1-5 整数（5 为最好）。strengths、improvements 各 2-4 条。`

  const content = await chatCompletion(
    [
      { role: 'system', content: '你是教学评价专家，输出必须是合法 JSON。' },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true },
  )

  const parsed = parseJsonSafe(content)
  const dims = parsed.dimensions && typeof parsed.dimensions === 'object' ? parsed.dimensions : {}

  return {
    summary: String(parsed.summary || ''),
    score: Math.min(5, Math.max(1, Number(parsed.score) || 3)),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.map(String) : [],
    dimensions: {
      content: Math.min(5, Math.max(1, Number(dims.content) || 3)),
      logic: Math.min(5, Math.max(1, Number(dims.logic) || 3)),
      focus: Math.min(5, Math.max(1, Number(dims.focus) || 3)),
      expression: Math.min(5, Math.max(1, Number(dims.expression) || 3)),
    },
  }
}

export async function generateQuiz({ title, analysis, transcriptSummary }) {
  const level = analysis.difficultyLevel ?? 3
  const questionCount = level <= 2 ? 5 : level <= 3 ? 8 : 10

  const prompt = `根据以下课堂内容与分析结果，生成课后习题。

课程：${title}
难度等级：${level}/5
重点：${(analysis.keyPoints || []).join('；')}
难点：${(analysis.difficultPoints || []).join('；')}
知识点：${(analysis.knowledgeTags || []).join('、')}
内容摘要：${analysis.summary}
转写摘要：${transcriptSummary?.slice(0, 2000) || ''}

请生成约 ${questionCount} 道题，包含选择题、填空题、简答题，难度与课堂难度匹配。
严格返回 JSON：
{
  "questions": [
    {
      "questionType": "choice|blank|short",
      "stem": "题干",
      "options": {"A":"...", "B":"...", "C":"...", "D":"..."},
      "answer": "标准答案",
      "explanation": "解析",
      "difficulty": 3,
      "knowledgeTag": "关联知识点"
    }
  ]
}

填空题 options 可为 null；简答题 options 为 null。`

  const content = await chatCompletion(
    [
      { role: 'system', content: '你是出题专家，输出必须是合法 JSON。' },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true },
  )

  const parsed = parseJsonSafe(content)
  const questions = Array.isArray(parsed.questions) ? parsed.questions : []
  return questions.map((q) => ({
    questionType: q.questionType || 'short',
    stem: String(q.stem || ''),
    options: q.options || null,
    answer: String(q.answer || ''),
    explanation: String(q.explanation || ''),
    difficulty: Math.min(5, Math.max(1, Number(q.difficulty) || level)),
    knowledgeTag: String(q.knowledgeTag || ''),
  }))
}

async function buildMindMapWithRetry(params) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await generateMindMap(params)
    } catch (err) {
      lastError = err
      console.warn(`[mindMap] attempt ${attempt + 1} failed:`, err.message)
    }
  }
  throw lastError || new Error('思维导图生成失败')
}

export async function runFullAnalysis(sessionStore, sessionId, roundNumber = null) {
  const session = sessionStore.getSession(sessionId)
  if (!session) throw new Error('课程不存在')

  let round
  if (roundNumber != null) {
    round = sessionStore.getRoundByNumber(sessionId, roundNumber)
  } else {
    round =
      sessionStore.getLatestEndedRound(sessionId) ||
      sessionStore.getActiveRound(sessionId) ||
      sessionStore.getLatestRound(sessionId)
  }
  if (!round) throw new Error('课次不存在')

  const roundId = round.id
  const transcript = sessionStore.getFullTranscriptText(sessionId, roundId)
  const transcriptBySlide = sessionStore.getTranscriptBySlide(sessionId, roundId)

  if (!transcript.trim()) {
    throw new Error('该节暂无转写内容，无法生成分析报告')
  }

  const roundLabel = round.round_number > 1 ? `（第 ${round.round_number} 节）` : ''
  const lessonTitle = `${session.title}${roundLabel}`

  const analysisCore = await analyzeLesson({
    title: lessonTitle,
    transcript,
    transcriptBySlide,
  })

  const evaluation = await generateLessonEvaluation({
    title: lessonTitle,
    transcript,
    transcriptBySlide,
    analysis: analysisCore,
  })

  const mindMap = await buildMindMapWithRetry({
    title: lessonTitle,
    transcript,
    transcriptBySlide,
    analysis: analysisCore,
  })

  const analysis = { ...analysisCore, evaluation, mindMap }
  sessionStore.saveAnalysis(sessionId, roundId, analysis)

  const questions = await generateQuiz({
    title: lessonTitle,
    analysis,
    transcriptSummary: transcript,
  })
  sessionStore.saveQuestions(sessionId, roundId, questions)

  return { analysis, questions, roundNumber: round.round_number }
}

export { generateMindMap }
