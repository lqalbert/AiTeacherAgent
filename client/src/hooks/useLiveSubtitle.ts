import { useCallback, useRef, useState } from 'react'
import {
  cleanSubtitleDisplay,
  extractCompleteSentences,
  formatLiveSubtitleSentence,
  isProgressiveUtterance,
  looksLikeCompleteSentence,
  pickProgressiveText,
} from '../utils/liveSubtitle'

export type LyricLineStatus = 'past' | 'current' | 'upcoming'

export type LiveSubtitleLine = {
  id: number
  text: string
  speaker: number
  status: LyricLineStatus
  /** 保留字段：直播式字幕上屏后均为完整句 */
  interim?: boolean
}

const MAX_HISTORY = 500
/** 停顿后：有完整句则上屏；无标点时也视为一句结束 */
const SILENCE_COMMIT_MS = 1100
/** final 后稍等，便于同一句递进合并 */
const STABLE_DEBOUNCE_MS = 380
/** 持续说话时：只抽出已有句号的完整句上屏，未完部分继续攒 */
const HOLD_EXTRACT_MS = 4500
/** 上屏后短时间递进修订同一行 */
const REVISE_WINDOW_MS = 5500
/** 无标点时，停顿上屏的最短字数 */
const MIN_PAUSE_SENTENCE_CHARS = 8

type DraftState = {
  text: string
  silenceTimer: ReturnType<typeof setTimeout> | null
  revealTimer: ReturnType<typeof setTimeout> | null
  holdTimer: ReturnType<typeof setTimeout> | null
  updatedAt: number
}

/**
 * 直播式字幕：攒完整句后上屏；展示去掉标点，一句一行。
 * 识别中不把半句话打到大屏；停顿或句末后再呈现。
 */
export function useLiveSubtitle() {
  const [lines, setLines] = useState<LiveSubtitleLine[]>([])

  const idRef = useRef(0)
  const linesRef = useRef<LiveSubtitleLine[]>([])
  const draftBySpeakerRef = useRef<Record<number, DraftState>>({})
  const lastRevealAtRef = useRef<Record<number, number>>({})
  const lastLineIdBySpeakerRef = useRef<Record<number, number>>({})

  const publish = useCallback((next: LiveSubtitleLine[]) => {
    const sliced = next.slice(-MAX_HISTORY)
    linesRef.current = sliced
    setLines(sliced)
  }, [])

  const getDraft = (speaker: number): DraftState => {
    if (!draftBySpeakerRef.current[speaker]) {
      draftBySpeakerRef.current[speaker] = {
        text: '',
        silenceTimer: null,
        revealTimer: null,
        holdTimer: null,
        updatedAt: 0,
      }
    }
    return draftBySpeakerRef.current[speaker]
  }

  const clearDraftTimers = (draft: DraftState) => {
    if (draft.silenceTimer) {
      clearTimeout(draft.silenceTimer)
      draft.silenceTimer = null
    }
    if (draft.revealTimer) {
      clearTimeout(draft.revealTimer)
      draft.revealTimer = null
    }
    if (draft.holdTimer) {
      clearTimeout(draft.holdTimer)
      draft.holdTimer = null
    }
  }

  const appendSentenceLine = useCallback(
    (speaker: number, sentence: string) => {
      // 上屏不展示标点：一句一行即可
      const cleaned = cleanSubtitleDisplay(sentence)
      if (!cleaned) return

      const prev = linesRef.current
      const lastId = lastLineIdBySpeakerRef.current[speaker]
      const lastIdx = lastId != null ? prev.findIndex((l) => l.id === lastId) : -1
      const lastLine = lastIdx >= 0 ? prev[lastIdx] : null
      const now = Date.now()
      const recentlyRevealed =
        lastLine && now - (lastRevealAtRef.current[speaker] || 0) < REVISE_WINDOW_MS

      const candidates: { line: (typeof prev)[number]; idx: number }[] = []
      if (lastLine && lastIdx >= 0) candidates.push({ line: lastLine, idx: lastIdx })
      if (recentlyRevealed) {
        for (let i = lastIdx - 1; i >= 0 && candidates.length < 3; i -= 1) {
          if (prev[i].speaker === speaker) candidates.push({ line: prev[i], idx: i })
        }
      }

      for (const { line, idx } of candidates) {
        if (!isProgressiveUtterance(line.text, cleaned)) continue
        const merged = pickProgressiveText(line.text, cleaned)
        if (idx === lastIdx) {
          if (merged === line.text) return
          const revised = prev.map((l) => {
            if (l.id === line.id) {
              return { ...l, text: merged, status: 'current' as const, interim: false }
            }
            if (l.status === 'current') return { ...l, status: 'past' as const }
            return l
          })
          lastRevealAtRef.current[speaker] = now
          publish(revised)
          return
        }
        return
      }

      if (lastLine && lastLine.text === cleaned) return

      const id = ++idRef.current
      lastLineIdBySpeakerRef.current[speaker] = id
      lastRevealAtRef.current[speaker] = now

      const next = prev.map((l) =>
        l.status === 'current' ? { ...l, status: 'past' as const, interim: false } : l,
      )
      next.push({
        id,
        text: cleaned,
        speaker,
        status: 'current',
        interim: false,
      })
      publish(next)
    },
    [publish],
  )

  /**
   * 从草稿抽出完整句上屏。
   * - commitRest: 停顿/结束时，把剩余无标点片段也作为一句上屏
   * - onlyPunctuated: 持续说话超时，只上屏带句末标点的句子
   */
  const revealFromDraft = useCallback(
    (speaker: number, opts: { commitRest?: boolean; onlyPunctuated?: boolean } = {}) => {
      const draft = getDraft(speaker)
      const { commitRest = false, onlyPunctuated = false } = opts
      if (!draft.text) {
        clearDraftTimers(draft)
        return
      }

      const { sentences, rest } = extractCompleteSentences(draft.text)
      for (const s of sentences) appendSentenceLine(speaker, s)

      if (onlyPunctuated) {
        draft.text = rest
        if (!rest) clearDraftTimers(draft)
        return
      }

      if (commitRest && rest) {
        if (rest.length >= MIN_PAUSE_SENTENCE_CHARS || looksLikeCompleteSentence(rest) || rest.length >= 4) {
          appendSentenceLine(speaker, rest)
        }
        draft.text = ''
        clearDraftTimers(draft)
        return
      }

      draft.text = rest
      if (!rest) clearDraftTimers(draft)
    },
    [appendSentenceLine],
  )

  const scheduleSilenceCommit = useCallback(
    (speaker: number) => {
      const draft = getDraft(speaker)
      if (draft.silenceTimer) clearTimeout(draft.silenceTimer)
      draft.silenceTimer = setTimeout(() => {
        draft.silenceTimer = null
        if (!draft.text) return
        revealFromDraft(speaker, { commitRest: true })
      }, SILENCE_COMMIT_MS)
    },
    [revealFromDraft],
  )

  const armHoldTimer = useCallback(
    (speaker: number) => {
      const draft = getDraft(speaker)
      if (draft.holdTimer) return
      draft.holdTimer = setTimeout(() => {
        draft.holdTimer = null
        if (!draft.text) return
        // 只抽出已有句号的完整句，半句继续等
        revealFromDraft(speaker, { onlyPunctuated: true })
        if (draft.text) armHoldTimer(speaker)
      }, HOLD_EXTRACT_MS)
    },
    [revealFromDraft],
  )

  const onLive = useCallback(
    (text: string, stable: boolean, speaker = 0) => {
      const cleaned = formatLiveSubtitleSentence(text)
      if (!cleaned) return
      const spk = speaker > 0 ? speaker : 0
      const draft = getDraft(spk)

      if (!draft.text) {
        draft.text = cleaned
      } else if (isProgressiveUtterance(draft.text, cleaned)) {
        draft.text = pickProgressiveText(draft.text, cleaned)
      } else if (draft.text !== cleaned) {
        // 新句：先把旧草稿按完整句收束上屏，再开始攒新句
        revealFromDraft(spk, { commitRest: true })
        draft.text = cleaned
      }

      // 草稿里已有句末标点的完整句，立刻抽出去上屏
      const { sentences, rest } = extractCompleteSentences(draft.text)
      if (sentences.length > 0) {
        for (const s of sentences) appendSentenceLine(spk, s)
        draft.text = rest
      }

      draft.updatedAt = Date.now()
      armHoldTimer(spk)

      if (!stable) {
        scheduleSilenceCommit(spk)
        return
      }

      if (draft.silenceTimer) {
        clearTimeout(draft.silenceTimer)
        draft.silenceTimer = null
      }
      if (draft.revealTimer) clearTimeout(draft.revealTimer)
      draft.revealTimer = setTimeout(() => {
        draft.revealTimer = null
        // final：抽出完整句；剩余等停顿再收
        revealFromDraft(spk, { commitRest: false })
        if (draft.text) scheduleSilenceCommit(spk)
      }, STABLE_DEBOUNCE_MS)
    },
    [appendSentenceLine, armHoldTimer, revealFromDraft, scheduleSilenceCommit],
  )

  const flush = useCallback(() => {
    for (const key of Object.keys(draftBySpeakerRef.current)) {
      const spk = Number(key)
      const draft = draftBySpeakerRef.current[spk]
      if (draft?.text) revealFromDraft(spk, { commitRest: true })
      else if (draft) clearDraftTimers(draft)
    }
  }, [revealFromDraft])

  const reset = useCallback(() => {
    for (const draft of Object.values(draftBySpeakerRef.current)) {
      clearDraftTimers(draft)
    }
    draftBySpeakerRef.current = {}
    lastRevealAtRef.current = {}
    lastLineIdBySpeakerRef.current = {}
    linesRef.current = []
    idRef.current = 0
    setLines([])
  }, [])

  return { lines, onLive, flush, reset }
}
