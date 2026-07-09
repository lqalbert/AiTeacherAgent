import { generateMindMap } from './mindMap.js'
import { chatCompletion, parseJsonSafe } from './chat.js'
import { buildLessonEvidence } from './lessonContext.js'

const STRICT_SYSTEM =
  '你是资深教研员与教学督导。所有结论必须严格基于提供的课件原文与课堂转写证据，禁止依据课程标题猜测内容，禁止编造课堂上未出现的知识点、例题或教学行为。输出必须是合法 JSON。'

async function analyzeLesson(evidence) {
  const { pageEvidence, fullTranscript, stats, meta } = evidence

  const prompt = `请根据以下**真实课堂证据**（课件各页文字 + 教师各页口述 + 完整转写），分析本节课实际讲授的重难点并撰写总结。

## 重要原则
1. **禁止**依据课程标题「${meta.roundLabel || meta.pptFilename || '未知'}」推断教学内容；标题仅供参考
2. **只能**使用下方课件内容与教师口述中明确出现的信息
3. 若某页课件有内容但教师未讲透，应在难点中如实指出
4. 若教师讲了但课件未写的内容，以口述为准纳入分析
5. 总结、重点、难点必须具体，避免「本节课内容丰富」「讲解清晰」等空话

## 课堂数据
- 课件页数：${stats.pptPageCount}（含文字页 ${stats.pptTextPages}）
- 教师有口述的页数：${stats.taughtPages}
- 转写字数：约 ${stats.transcriptChars}

## 按页证据（课件 + 讲解对齐，优先阅读）
${pageEvidence}

## 完整课堂转写
${fullTranscript}

请严格返回 JSON：
{
  "keyPoints": ["基于证据的具体重点，每条须能在转写或课件中找到依据"],
  "difficultPoints": ["基于证据的具体难点，指出学生可能卡住的环节"],
  "summary": "300-500字课堂总结：本节课实际讲了什么、怎么讲的、学生应掌握什么。必须引用具体知识点或教学环节，禁止泛泛而谈",
  "difficultyLevel": 3,
  "knowledgeTags": ["从课堂中提取的具体知识点标签"]
}

difficultyLevel 为 1-5 整数（3=普通中学课堂难度）。`

  const content = await chatCompletion(
    [
      { role: 'system', content: STRICT_SYSTEM },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true, temperature: 0.2 },
  )

  const parsed = parseJsonSafe(content)
  return {
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
    difficultPoints: Array.isArray(parsed.difficultPoints) ? parsed.difficultPoints.map(String) : [],
    summary: String(parsed.summary || ''),
    difficultyLevel: Math.min(5, Math.max(1, Number(parsed.difficultyLevel) || 3)),
    knowledgeTags: Array.isArray(parsed.knowledgeTags) ? parsed.knowledgeTags.map(String) : [],
  }
}

/** AI 生成本节课教学评价（严格、可成长） */
export async function generateLessonEvaluation(evidence, analysis) {
  const { pageEvidence, fullTranscript, stats } = evidence

  const prompt = `你是一位**高标准、直言不讳**的教学督导。请仅根据下方课堂证据，对本节课教学表现做**严格、具体、可落地**的评价，助力教师专业成长。

## 评价原则
1. **不看课程标题**，只看课件内容与教师真实授课
2. 每一条亮点必须指出**具体页码/环节/原话依据**（如「第3页讲解…时…」）
3. 每一条改进建议必须**可操作**，指出**具体问题**（如「第5页课件出现X概念，但教师未举例，学生易混淆Y」）
4. **禁止**空洞套话：如「加强互动」「提高兴趣」「注重启发」「条理清晰」等无证据的评价
5. 评分从严：3分=达标，4分=良好，5分=优秀；有明显问题时敢于给 2 分
6. 若转写过少（仅 ${stats.taughtPages} 页有口述），须在评价中说明证据不足对结论的影响

## 教研分析（辅助，仍以证据为准）
- 总结：${analysis?.summary || '（无）'}
- 重点：${(analysis?.keyPoints || []).join('；') || '（无）'}
- 难点：${(analysis?.difficultPoints || []).join('；') || '（无）'}

## 按页证据
${pageEvidence}

## 完整转写
${fullTranscript}

从教学内容准确性、讲解逻辑、重点把握、语言表达与课堂节奏等维度评价。

严格返回 JSON：
{
  "summary": "300-500字综合评价：先概括本节课实际成效，再指出最关键的问题与成长方向。必须具体，禁止套话",
  "score": 3,
  "strengths": ["带页码/环节依据的具体亮点，2-4条"],
  "improvements": ["带具体问题描述与改进做法的建议，2-5条，要尖锐但建设性"],
  "dimensions": {
    "content": 3,
    "logic": 3,
    "focus": 3,
    "expression": 3
  }
}

score 与 dimensions 均为 1-5 整数。`

  const content = await chatCompletion(
    [
      {
        role: 'system',
        content:
          '你是严格的教学督导。评价必须基于证据、具体可执行，拒绝空洞表扬与泛泛建议。输出合法 JSON。',
      },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true, temperature: 0.25 },
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

export async function generateQuiz(evidence, analysis) {
  const { pageEvidence, fullTranscript, stats } = evidence
  const level = analysis.difficultyLevel ?? 3
  const questionCount = level <= 2 ? 5 : level <= 3 ? 8 : 10

  const prompt = `根据以下**本节课实际讲授内容**生成课后检测题。题目必须来自课堂中明确讲过的知识点，禁止出超纲题或泛泛的教科书题。

## 出题原则
1. **不看课程标题**，只依据课件与教师口述
2. 每道题必须能在按页证据或转写中找到出题依据
3. 题干尽量贴近教师课堂表述方式；解析中注明「本节课第X页/教师讲解了…」
4. 覆盖本节课重点，含 1-2 道易错题或易混淆点（若课堂中有）
5. 禁止出课堂上完全未涉及的知识

## 课堂数据
- 有口述页数：${stats.taughtPages}
- 难度等级：${level}/5

## 教研分析
- 重点：${(analysis.keyPoints || []).join('；')}
- 难点：${(analysis.difficultPoints || []).join('；')}
- 知识点：${(analysis.knowledgeTags || []).join('、')}
- 总结：${analysis.summary}

## 按页证据（出题依据）
${pageEvidence}

## 完整转写
${fullTranscript}

请生成约 ${questionCount} 道题，包含选择题、填空题、简答题，难度与课堂匹配。
严格返回 JSON：
{
  "questions": [
    {
      "questionType": "choice|blank|short",
      "stem": "题干（紧扣本节课内容）",
      "options": {"A":"...", "B":"...", "C":"...", "D":"..."},
      "answer": "标准答案",
      "explanation": "解析：说明依据来自本节课哪部分讲授",
      "difficulty": 3,
      "knowledgeTag": "关联的本节课知识点"
    }
  ]
}

填空题、简答题 options 为 null。`

  const content = await chatCompletion(
    [
      {
        role: 'system',
        content: '你是出题专家。题目必须严格基于本节课实际讲授内容，禁止空洞与超纲。输出合法 JSON。',
      },
      { role: 'user', content: prompt },
    ],
    { jsonMode: true, temperature: 0.2 },
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
  const slideEvents = sessionStore.getSlideEvents(sessionId, roundId)

  if (!transcript.trim()) {
    throw new Error('该节暂无转写内容，无法生成分析报告')
  }

  const roundLabel = round.round_number > 1 ? `第 ${round.round_number} 节课` : ''
  const evidence = await buildLessonEvidence({
    session,
    transcript,
    transcriptBySlide,
    slideEvents,
    roundLabel,
  })

  const analysisCore = await analyzeLesson(evidence)

  const evaluation = await generateLessonEvaluation(evidence, analysisCore)

  const mindMap = await buildMindMapWithRetry({
    evidence,
    analysis: analysisCore,
  })

  const analysis = { ...analysisCore, evaluation, mindMap }
  sessionStore.saveAnalysis(sessionId, roundId, analysis)

  const questions = await generateQuiz(evidence, analysisCore)
  sessionStore.saveQuestions(sessionId, roundId, questions)

  return { analysis, questions, roundNumber: round.round_number }
}

export { generateMindMap }
