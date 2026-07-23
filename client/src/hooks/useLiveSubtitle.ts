import { useCallback, useRef, useState } from 'react'
import {
  cleanSubtitleDisplay,
  isProgressiveUtterance,
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
/** 停顿后视为一句结束并上屏 */
const SILENCE_COMMIT_MS = 650
/** final 后短防抖，合并递进结果 */
const REVEAL_DEBOUNCE_MS = 280
/** 草稿最长等待：持续说话时也定期上屏，避免一直空白 */
const MAX_HOLD_MS = 3500
/** 上屏后短时间递进修订同一行 */
const REVISE_WINDOW_MS = 2800

type DraftState = {
  text: string
  silenceTimer: ReturnType<typeof setTimeout> | null
  revealTimer: ReturnType<typeof setTimeout> | null
  holdTimer: ReturnType<typeof setTimeout> | null
  updatedAt: number
}

/**
 * 直播式字幕：识别中先缓存，一句结束后一次性上屏。
 * 同时保证：final 必上屏、停顿上屏、超时强制上屏，避免中途长时间无字幕。
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

  const looksLikeSentenceEnd = (text: string) =>
    /[。！？!?；…]$/.test(text) || (text.length >= 10 && /[。！？!?；…]/.test(text))

  const commitReveal = useCallback(
    (speaker: number, forceText?: string) => {
      const draft = getDraft(speaker)
      const cleaned = cleanSubtitleDisplay(forceText ?? draft.text)
      clearDraftTimers(draft)
      draft.text = ''
      draft.updatedAt = 0

      if (!cleaned) return

      const prev = linesRef.current
      const lastId = lastLineIdBySpeakerRef.current[speaker]
      const lastIdx = lastId != null ? prev.findIndex((l) => l.id === lastId) : -1
      const lastLine = lastIdx >= 0 ? prev[lastIdx] : null
      const now = Date.now()
      const recentlyRevealed =
        lastLine && now - (lastRevealAtRef.current[speaker] || 0) < REVISE_WINDOW_MS

      if (lastLine && recentlyRevealed && isProgressiveUtterance(lastLine.text, cleaned)) {
        const merged = pickProgressiveText(lastLine.text, cleaned)
        if (merged === lastLine.text) return
        const revised = prev.map((l) => {
          if (l.id === lastId) {
            return { ...l, text: merged, status: 'current' as const, interim: false }
          }
          if (l.status === 'current') return { ...l, status: 'past' as const }
          return l
        })
        lastRevealAtRef.current[speaker] = now
        publish(revised)
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

  const scheduleReveal = useCallback(
    (speaker: number, delayMs: number) => {
      const draft = getDraft(speaker)
      if (!draft.text) return
      if (draft.revealTimer) clearTimeout(draft.revealTimer)
      draft.revealTimer = setTimeout(() => {
        draft.revealTimer = null
        commitReveal(speaker)
      }, delayMs)
    },
    [commitReveal],
  )

  const armHoldTimer = useCallback(
    (speaker: number) => {
      const draft = getDraft(speaker)
      if (draft.holdTimer) return
      draft.holdTimer = setTimeout(() => {
        draft.holdTimer = null
        if (draft.text) scheduleReveal(speaker, 0)
      }, MAX_HOLD_MS)
    },
    [scheduleReveal],
  )

  const scheduleSilenceCommit = useCallback(
    (speaker: number) => {
      const draft = getDraft(speaker)
      if (draft.silenceTimer) clearTimeout(draft.silenceTimer)
      draft.silenceTimer = setTimeout(() => {
        draft.silenceTimer = null
        if (!draft.text) return
        scheduleReveal(speaker, 0)
      }, SILENCE_COMMIT_MS)
    },
    [scheduleReveal],
  )

  const onLive = useCallback(
    (text: string, stable: boolean, speaker = 0) => {
      const cleaned = cleanSubtitleDisplay(text)
      if (!cleaned) return
      const spk = speaker > 0 ? speaker : 0
      const draft = getDraft(spk)

      if (!draft.text) {
        draft.text = cleaned
      } else if (isProgressiveUtterance(draft.text, cleaned)) {
        draft.text = pickProgressiveText(draft.text, cleaned)
      } else if (draft.text !== cleaned) {
        // 新句：先上屏旧草稿
        commitReveal(spk, draft.text)
        draft.text = cleaned
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
      const delay = looksLikeSentenceEnd(draft.text) ? 120 : REVEAL_DEBOUNCE_MS
      scheduleReveal(spk, delay)
    },
    [armHoldTimer, commitReveal, scheduleReveal, scheduleSilenceCommit],
  )

  const flush = useCallback(() => {
    for (const key of Object.keys(draftBySpeakerRef.current)) {
      const spk = Number(key)
      const draft = draftBySpeakerRef.current[spk]
      if (draft?.text) commitReveal(spk)
      else if (draft) clearDraftTimers(draft)
    }
  }, [commitReveal])

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
