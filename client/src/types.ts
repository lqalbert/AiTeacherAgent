export type SubtitleStyle = {
  color: string
  fontSize: number
  fontFamily: string
  position: 'bottom' | 'top' | 'custom'
  backgroundColor: string
  backgroundOpacity: number
  /** 课堂页右侧「实时字幕」区域背景色 */
  panelBackgroundColor: string
  customX?: number
  customY?: number
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  color: '#ffffff',
  fontSize: 24,
  fontFamily: '"HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  position: 'bottom',
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  panelBackgroundColor: '#ffffff',
}

export const SUBTITLE_STYLE_KEY = 'aiteacher_subtitle_style'

export function loadSubtitleStyle(): SubtitleStyle {
  try {
    const raw = localStorage.getItem(SUBTITLE_STYLE_KEY)
    if (!raw) return { ...DEFAULT_SUBTITLE_STYLE }
    return { ...DEFAULT_SUBTITLE_STYLE, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SUBTITLE_STYLE }
  }
}

export function saveSubtitleStyle(style: SubtitleStyle) {
  localStorage.setItem(SUBTITLE_STYLE_KEY, JSON.stringify(style))
}

export type Session = {
  id: number
  title: string
  ppt_filename: string | null
  ppt_path: string | null
  subtitle_style: SubtitleStyle
  status: string
  started_at: string
  ended_at: string | null
  segment_count?: number
  current_round?: number
  next_round_number?: number
  round_count?: number
  ended_round_count?: number
  has_analysis?: boolean
  active_round_id?: number | null
  rounds?: LessonRound[]
}

export type LessonRound = {
  id: number
  session_id: number
  round_number: number
  status: string
  started_at: string
  started_at_ms: number
  ended_at: string | null
  segment_count?: number
  has_analysis?: boolean
}

export type TranscriptSegment = {
  id: number
  session_id: number
  round_id?: number | null
  slide_index: number
  text: string
  start_ms: number | null
  end_ms: number | null
  is_final: number
}

export type MindMapNode = {
  label: string
  children?: MindMapNode[]
}

export type LessonEvaluation = {
  summary: string
  score: number
  strengths: string[]
  improvements: string[]
  dimensions?: {
    content: number
    logic: number
    focus: number
    expression: number
  }
}

export type AnalysisResult = {
  keyPoints: string[]
  difficultPoints: string[]
  summary: string
  difficultyLevel: number
  knowledgeTags: string[]
  mindMap?: MindMapNode | null
  evaluation?: LessonEvaluation | null
  createdAt?: string
}

export type Question = {
  id?: number
  questionType: 'choice' | 'blank' | 'short' | string
  stem: string
  options: Record<string, string> | null
  answer: string
  explanation: string
  difficulty: number
  knowledgeTag: string
}

export type Report = {
  session: Session
  rounds?: LessonRound[]
  currentRound?: LessonRound | null
  transcript: TranscriptSegment[]
  slideEvents: { slide_index: number; event_at_ms: number }[]
  analysis: AnalysisResult | null
  questions: Question[]
}
