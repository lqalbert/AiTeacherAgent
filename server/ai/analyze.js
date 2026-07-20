import { generateMindMap } from './mindMap.js'
import { chatCompletion, parseJsonSafe } from './chat.js'
import { buildLessonEvidence } from './lessonContext.js'
import { getAgentConfig, getKnowledgeCorpus } from '../agent/configStore.js'

function buildStrictSystem(config) {
  const role = config?.role || {}
  const lines = [
    `你是教育智能体「${role.name || '智课随行'}」。`,
    role.mission ? `任务目标：${role.mission}` : '',
    role.persona ? `人设与原则：\n${role.persona}` : '',
    role.boundaries ? `能力边界：\n${role.boundaries}` : '',
    '所有结论必须严格基于提供的课件原文、知识库资料与课堂转写证据，禁止依据课程标题猜测内容，禁止编造课堂上未出现的知识点、例题或教学行为。按页无转写不等于未讲授。输出必须是合法 JSON。',
  ]
  return lines.filter(Boolean).join('\n')
}

function enabledSections(config) {
  return config?.report?.sections || {}
}

function knowledgeBlock(corpus) {
  if (!corpus?.trim()) return '（当前知识库为空；请注意知识库≠上课 PPT，上课 PPT 仍单独作为课件证据）'
  return corpus
}

async function analyzeLesson(evidence, config, knowledgeCorpus) {
  const { pageEvidence, fullTranscript, stats, meta, dataNote } = evidence
  const sections = enabledSections(config)
  const wantKey = sections.keyPoints?.enabled !== false
  const wantDiff = sections.difficultPoints?.enabled !== false
  const wantSummary = sections.summary?.enabled !== false
  const wantTags = sections.knowledgeTags?.enabled !== false

  const jsonShape = {
    ...(wantKey ? { keyPoints: ['基于证据的具体重点'] } : {}),
    ...(wantDiff ? { difficultPoints: ['基于证据的具体难点'] } : {}),
    ...(wantSummary
      ? {
          summary:
            '300-500字课堂总结：本节课实际讲了什么、怎么讲的、学生应掌握什么',
        }
      : {}),
    difficultyLevel: 3,
    ...(wantTags ? { knowledgeTags: ['从课堂中提取的具体知识点标签'] } : {}),
  }

  const prompt = `请根据以下**真实课堂证据**（课件各页文字 + 教师各页口述 + 完整转写 + 知识库资料），分析本节课。

## 重要原则
1. **禁止**依据课程标题「${meta.roundLabel || meta.pptFilename || '未知'}」推断教学内容
2. **只能**使用下方课件、知识库与教师口述中明确出现的信息
3. **知识库 ≠ 上课 PPT**：知识库是教师预先配置的补充资料；上课 PPT 是本节放映课件，二者分开使用
4. **完整转写是主体证据**：若页面状态为「翻过页但本页无转写」，不得推断教师未讲该页
5. 总结、重点、难点必须具体，禁止空话

## 数据说明（必读）
${dataNote || '（无）'}

## 智能体知识库（手动配置，非上课 PPT）
${knowledgeBlock(knowledgeCorpus)}

## 课堂数据
- 课件页数：${stats.pptPageCount}（含文字页 ${stats.pptTextPages}）
- 翻到过：${stats.visitedPages} 页；按页有转写：${stats.taughtPages} 页
- 转写字数：约 ${stats.transcriptChars}

## 按页证据（上课 PPT + 口述对齐）
${pageEvidence}

## 完整课堂转写
${fullTranscript}

请严格返回 JSON：
${JSON.stringify(jsonShape, null, 2)}

difficultyLevel 为 1-5 整数。未启用的字段请省略。`

  const content = await chatCompletion(
    [
      { role: 'system', content: buildStrictSystem(config) },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true, temperature: 0.2 },
  )

  const parsed = parseJsonSafe(content)
  return {
    keyPoints: wantKey && Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
    difficultPoints:
      wantDiff && Array.isArray(parsed.difficultPoints) ? parsed.difficultPoints.map(String) : [],
    summary: wantSummary ? String(parsed.summary || '') : '',
    difficultyLevel: Math.min(5, Math.max(1, Number(parsed.difficultyLevel) || 3)),
    knowledgeTags: wantTags && Array.isArray(parsed.knowledgeTags) ? parsed.knowledgeTags.map(String) : [],
  }
}

export async function generateLessonEvaluation(evidence, analysis, config, knowledgeCorpus) {
  const { pageEvidence, fullTranscript, stats, dataNote } = evidence
  const standards = config?.evaluation?.standards || ''
  const dims = (config?.evaluation?.dimensions || []).filter((d) => d.enabled !== false)
  const dimKeys = dims.length
    ? dims.map((d) => d.key)
    : ['content', 'logic', 'focus', 'expression']
  const dimLabels = dims.length
    ? dims.map((d) => `${d.label || d.key}（字段 ${d.key}）`).join('、')
    : '教学内容 content、讲解逻辑 logic、重点把握 focus、语言表达 expression'

  const dimJson = Object.fromEntries(dimKeys.map((k) => [k, 3]))

  const prompt = `你是一位**高标准、直言不讳**的教学督导。请仅根据下方课堂证据，按**用户配置的评价标准**对本节课做严格、具体、可落地的评价。

## 用户配置的评价标准（必须遵守）
${standards || '（未配置，请从教学内容、逻辑、重点、表达等维度评价）'}

## 评价原则
1. 不看课程标题，只看课件、知识库与教师真实授课（以完整转写为主）
2. 每一条亮点/改进建议必须具体可操作，禁止空洞套话
3. **禁止**把「按页无转写」当成「教师未讲该页」
4. 评分维度请输出：${dimLabels}

## 数据说明
${dataNote || '（无）'}
（翻到 ${stats.visitedPages} 页，按页有转写 ${stats.taughtPages} 页）

## 知识库（手动配置，≠上课 PPT）
${knowledgeBlock(knowledgeCorpus)}

## 教研分析（辅助）
- 总结：${analysis?.summary || '（无）'}
- 重点：${(analysis?.keyPoints || []).join('；') || '（无）'}
- 难点：${(analysis?.difficultPoints || []).join('；') || '（无）'}

## 按页证据
${pageEvidence}

## 完整转写
${fullTranscript}

严格返回 JSON：
{
  "summary": "300-500字综合评价",
  "score": 3,
  "strengths": ["具体亮点 2-4 条"],
  "improvements": ["具体改进建议 2-5 条"],
  "dimensions": ${JSON.stringify(dimJson)}
}

score 与 dimensions 均为 1-5 整数。`

  const content = await chatCompletion(
    [
      {
        role: 'system',
        content: `${buildStrictSystem(config)}\n评价必须基于证据与用户配置标准，拒绝空洞表扬。输出合法 JSON。`,
      },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true, temperature: 0.25 },
  )

  const parsed = parseJsonSafe(content)
  const parsedDims = parsed.dimensions && typeof parsed.dimensions === 'object' ? parsed.dimensions : {}
  const dimensions = {}
  for (const key of dimKeys) {
    dimensions[key] = Math.min(5, Math.max(1, Number(parsedDims[key]) || 3))
  }

  return {
    summary: String(parsed.summary || ''),
    score: Math.min(5, Math.max(1, Number(parsed.score) || 3)),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.map(String) : [],
    dimensions,
  }
}

export async function generateQuiz(evidence, analysis, config, knowledgeCorpus) {
  const { pageEvidence, fullTranscript, stats } = evidence
  const level = analysis.difficultyLevel ?? 3
  const types = (config?.homework?.types || []).filter((t) => t.enabled !== false && Number(t.count) > 0)

  if (!types.length) return []

  const plan = types.map((t) => `${t.label || t.type} ${t.count} 道（questionType=${t.type}）`).join('；')
  const total = types.reduce((n, t) => n + Number(t.count || 0), 0)

  const prompt = `根据以下**本节课实际讲授内容**生成课后作业。题目必须来自课堂中明确讲过的知识点。

## 用户配置的题型与题量（必须严格遵守）
${plan}
合计约 ${total} 道。

## 出题原则
1. 不看课程标题，只依据课件、知识库与教师口述
2. 每道题必须能在证据中找到出题依据
3. questionType 只能使用配置中的类型：${types.map((t) => t.type).join('、')}
4. 各题型数量尽量精确匹配配置

## 课堂数据
- 有口述页数：${stats.taughtPages}
- 难度等级：${level}/5

## 知识库（≠上课 PPT）
${knowledgeBlock(knowledgeCorpus)}

## 教研分析
- 重点：${(analysis.keyPoints || []).join('；')}
- 难点：${(analysis.difficultPoints || []).join('；')}
- 知识点：${(analysis.knowledgeTags || []).join('、')}
- 总结：${analysis.summary}

## 按页证据
${pageEvidence}

## 完整转写
${fullTranscript}

严格返回 JSON：
{
  "questions": [
    {
      "questionType": "choice|blank|short",
      "stem": "题干",
      "options": {"A":"...","B":"...","C":"...","D":"..."},
      "answer": "标准答案",
      "explanation": "解析",
      "difficulty": 3,
      "knowledgeTag": "知识点"
    }
  ]
}

填空题、简答题 options 为 null。`

  const content = await chatCompletion(
    [
      {
        role: 'system',
        content: '你是出题专家。必须严格按用户配置的题型与题量出题，且题目基于本节课证据。输出合法 JSON。',
      },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true, temperature: 0.2 },
  )

  const parsed = parseJsonSafe(content)
  const questions = Array.isArray(parsed.questions) ? parsed.questions : []
  const allowed = new Set(types.map((t) => t.type))
  return questions
    .filter((q) => allowed.has(q.questionType) || allowed.has(String(q.questionType || '').toLowerCase()))
    .map((q) => ({
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
  const slideEvents = sessionStore.getSlideEvents(sessionId, roundId)

  if (!transcript.trim()) {
    throw new Error('该节暂无转写内容，无法生成分析报告')
  }

  if (!session.user_id) {
    throw new Error('课程未关联账号，无法读取智能体配置')
  }

  const config = getAgentConfig(session.user_id)
  const knowledgeCorpus = getKnowledgeCorpus(session.user_id)
  const sections = enabledSections(config)
  const skills = config.skills || []
  const skillOn = (key) => skills.find((s) => s.key === key)?.enabled !== false

  const roundLabel = round.round_number > 1 ? `第 ${round.round_number} 节课` : ''
  const evidence = await buildLessonEvidence({
    session,
    transcript,
    transcriptBySlide,
    slideEvents,
    roundLabel,
  })

  const analysisCore = await analyzeLesson(evidence, config, knowledgeCorpus)

  let evaluation = null
  if (sections.evaluation?.enabled !== false && skillOn('evaluate')) {
    evaluation = await generateLessonEvaluation(evidence, analysisCore, config, knowledgeCorpus)
  }

  let mindMap = null
  if (sections.mindMap?.enabled !== false && skillOn('structure')) {
    mindMap = await buildMindMapWithRetry({
      evidence,
      analysis: analysisCore,
    })
  }

  const analysis = { ...analysisCore, evaluation, mindMap }
  sessionStore.saveAnalysis(sessionId, roundId, analysis)

  let questions = []
  if (sections.homework?.enabled !== false && skillOn('quiz')) {
    questions = await generateQuiz(evidence, analysisCore, config, knowledgeCorpus)
  }
  sessionStore.saveQuestions(sessionId, roundId, questions)

  return { analysis, questions, roundNumber: round.round_number, configSnapshot: {
    reportSections: sections,
    homework: config.homework,
  } }
}

export { generateMindMap }
