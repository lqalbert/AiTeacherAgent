import { useCallback, useRef, useState } from 'react'
import { splitDisplaySentences, stripSubtitlePunctuation } from '../utils/liveSubtitle'

export type LyricLineStatus = 'past' | 'current' | 'upcoming'

export type LiveSubtitleLine = {
  id: number
  text: string
  speaker: number
  status: LyricLineStatus
}

type PendingPhrase = {
  text: string
  speaker: number
}

const MAX_HISTORY = 400
const DISPLAY_DELAY_MS = 900
const LINE_STAGGER_MS = 180

export function useLiveSubtitle() {
  const [lines, setLines] = useState<LiveSubtitleLine[]>([])

  const idRef = useRef(0)
  const lastLineBySpeakerRef = useRef<Record<number, string>>({})
  const pendingPhrasesRef = useRef<PendingPhrase[]>([])
  const staggerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const displayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearStaggerTimers = useCallback(() => {
    staggerTimersRef.current.forEach(clearTimeout)
    staggerTimersRef.current = []
  }, [])

  const appendLine = useCallback((text: string, speaker = 0) => {
    const cleaned = stripSubtitlePunctuation(text)
    if (!cleaned) return

    const lastForSpeaker = lastLineBySpeakerRef.current[speaker] || ''
    if (cleaned === lastForSpeaker) return
    lastLineBySpeakerRef.current[speaker] = cleaned

    const newLine: LiveSubtitleLine = {
      id: ++idRef.current,
      text: cleaned,
      speaker,
      status: 'current',
    }

    setLines((prev) => {
      const history = prev.map((l) =>
        l.status === 'current' ? { ...l, status: 'past' as const } : l,
      )
      return [...history, newLine].slice(-MAX_HISTORY)
    })
  }, [])

  const flushPending = useCallback(() => {
    const phrases = pendingPhrasesRef.current.splice(0)
    if (phrases.length === 0) return

    const sentences: PendingPhrase[] = []
    for (const phrase of phrases) {
      for (const part of splitDisplaySentences(phrase.text)) {
        sentences.push({ text: part, speaker: phrase.speaker })
      }
    }

    sentences.forEach((sentence, index) => {
      const timer = setTimeout(() => {
        appendLine(sentence.text, sentence.speaker)
      }, index * LINE_STAGGER_MS)
      staggerTimersRef.current.push(timer)
    })
  }, [appendLine])

  const scheduleDisplay = useCallback(() => {
    if (displayTimerRef.current) clearTimeout(displayTimerRef.current)
    displayTimerRef.current = setTimeout(() => {
      displayTimerRef.current = null
      flushPending()
    }, DISPLAY_DELAY_MS)
  }, [flushPending])

  const onLive = useCallback(
    (text: string, stable: boolean, speaker = 0) => {
      if (!stable) return

      const cleaned = stripSubtitlePunctuation(text)
      if (!cleaned || cleaned.length < 2) return

      const spk = speaker > 0 ? speaker : 0
      const tail = pendingPhrasesRef.current[pendingPhrasesRef.current.length - 1]
      if (tail?.text === cleaned && tail.speaker === spk) return

      pendingPhrasesRef.current.push({ text: cleaned, speaker: spk })
      scheduleDisplay()
    },
    [scheduleDisplay],
  )

  const flush = useCallback(() => {
    if (displayTimerRef.current) {
      clearTimeout(displayTimerRef.current)
      displayTimerRef.current = null
    }
    flushPending()
  }, [flushPending])

  const reset = useCallback(() => {
    if (displayTimerRef.current) clearTimeout(displayTimerRef.current)
    displayTimerRef.current = null
    clearStaggerTimers()
    pendingPhrasesRef.current = []
    lastLineBySpeakerRef.current = {}
    setLines([])
  }, [clearStaggerTimers])

  return { lines, onLive, flush, reset }
}
