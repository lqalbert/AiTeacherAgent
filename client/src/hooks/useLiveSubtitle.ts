import { useCallback, useRef, useState } from 'react'
import { splitDisplaySentences, stripSubtitlePunctuation } from '../utils/liveSubtitle'

export type LyricLineStatus = 'past' | 'current' | 'upcoming'

export type LiveSubtitleLine = {
  id: number
  text: string
  speaker: number
  status: LyricLineStatus
  /** 识别中的临时句，可被后续中间结果改写 */
  interim?: boolean
}

type PendingPhrase = {
  text: string
  speaker: number
}

const MAX_HISTORY = 500
/** 最终句拆分上屏的轻微错峰，避免整段一下子刷进来 */
const LINE_STAGGER_MS = 80

export function useLiveSubtitle() {
  const [lines, setLines] = useState<LiveSubtitleLine[]>([])

  const idRef = useRef(0)
  const lastStableBySpeakerRef = useRef<Record<number, string>>({})
  const interimIdBySpeakerRef = useRef<Record<number, number>>({})
  const pendingPhrasesRef = useRef<PendingPhrase[]>([])
  const staggerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const flushScheduledRef = useRef(false)

  const clearStaggerTimers = useCallback(() => {
    staggerTimersRef.current.forEach(clearTimeout)
    staggerTimersRef.current = []
  }, [])

  const appendStableLine = useCallback((text: string, speaker = 0) => {
    const cleaned = stripSubtitlePunctuation(text)
    if (!cleaned) return

    const lastForSpeaker = lastStableBySpeakerRef.current[speaker] || ''
    if (cleaned === lastForSpeaker) {
      // 用最终句替换同说话人的 interim
      setLines((prev) => {
        const interimId = interimIdBySpeakerRef.current[speaker]
        if (!interimId) return prev
        delete interimIdBySpeakerRef.current[speaker]
        return prev.map((l) =>
          l.id === interimId ? { ...l, text: cleaned, status: 'current', interim: false } : l,
        )
      })
      return
    }
    lastStableBySpeakerRef.current[speaker] = cleaned

    const newLine: LiveSubtitleLine = {
      id: ++idRef.current,
      text: cleaned,
      speaker,
      status: 'current',
      interim: false,
    }

    const interimId = interimIdBySpeakerRef.current[speaker]
    if (interimId) delete interimIdBySpeakerRef.current[speaker]

    setLines((prev) => {
      const withoutInterim = interimId ? prev.filter((l) => l.id !== interimId) : prev
      const history = withoutInterim.map((l) =>
        l.status === 'current' ? { ...l, status: 'past' as const } : l,
      )
      return [...history, newLine].slice(-MAX_HISTORY)
    })
  }, [])

  const upsertInterim = useCallback((text: string, speaker = 0) => {
    const cleaned = stripSubtitlePunctuation(text)
    if (!cleaned) return

    setLines((prev) => {
      const existingId = interimIdBySpeakerRef.current[speaker]
      if (existingId) {
        return prev.map((l) =>
          l.id === existingId
            ? { ...l, text: cleaned, status: 'current', interim: true }
            : l.status === 'current' && l.id !== existingId
              ? { ...l, status: 'past' as const }
              : l,
        )
      }

      const id = ++idRef.current
      interimIdBySpeakerRef.current[speaker] = id
      const history = prev.map((l) =>
        l.status === 'current' ? { ...l, status: 'past' as const } : l,
      )
      return [
        ...history,
        { id, text: cleaned, speaker, status: 'current' as const, interim: true },
      ].slice(-MAX_HISTORY)
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
        appendStableLine(sentence.text, sentence.speaker)
      }, index * LINE_STAGGER_MS)
      staggerTimersRef.current.push(timer)
    })
  }, [appendStableLine])

  const onLive = useCallback(
    (text: string, stable: boolean, speaker = 0) => {
      const cleaned = stripSubtitlePunctuation(text)
      if (!cleaned) return

      const spk = speaker > 0 ? speaker : 0

      // 中间结果：立刻改写当前 interim，零延迟
      if (!stable) {
        upsertInterim(cleaned, spk)
        return
      }

      // 最终结果：尽快拆句上屏（去掉原先 900ms 等待）
      const tail = pendingPhrasesRef.current[pendingPhrasesRef.current.length - 1]
      if (tail?.text === cleaned && tail.speaker === spk) return

      pendingPhrasesRef.current.push({ text: cleaned, speaker: spk })
      // 同一事件循环内合并连续最终句，接近实时且不丢句
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true
        queueMicrotask(() => {
          flushScheduledRef.current = false
          flushPending()
        })
      }
    },
    [flushPending, upsertInterim],
  )

  const flush = useCallback(() => {
    flushPending()
  }, [flushPending])

  const reset = useCallback(() => {
    clearStaggerTimers()
    pendingPhrasesRef.current = []
    lastStableBySpeakerRef.current = {}
    interimIdBySpeakerRef.current = {}
    setLines([])
  }, [clearStaggerTimers])

  return { lines, onLive, flush, reset }
}
