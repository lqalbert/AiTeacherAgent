import { useCallback, useRef, useState } from 'react'
import { SubtitleSentenceBuffer } from '../utils/subtitleBuffer'

const PAUSE_FLUSH_MS = 700
const INTERIM_DEBOUNCE_MS = 160

export function useSubtitleSentences() {
  const bufferRef = useRef(new SubtitleSentenceBuffer())
  const interimRef = useRef('')
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [liveLineIndex, setLiveLineIndex] = useState<number | null>(null)

  const refresh = useCallback(() => {
    const live = interimRef.current.trim()
    const display = bufferRef.current.getDisplayLines(live)
    setLines(display)
    setLiveLineIndex(live && display.length > 0 ? display.length - 1 : null)
  }, [])

  const schedulePauseFlush = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = setTimeout(() => {
      if (bufferRef.current.flushPendingAsSentence()) {
        interimRef.current = ''
        refresh()
      }
    }, PAUSE_FLUSH_MS)
  }, [refresh])

  const onFinalFragment = useCallback(
    (fragment: string) => {
      interimRef.current = ''
      bufferRef.current.pushFinal(fragment)
      refresh()
      schedulePauseFlush()
    },
    [refresh, schedulePauseFlush],
  )

  const onInterim = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      if (interimTimerRef.current) clearTimeout(interimTimerRef.current)
      interimTimerRef.current = setTimeout(() => {
        interimRef.current = trimmed
        refresh()
        schedulePauseFlush()
      }, INTERIM_DEBOUNCE_MS)
    },
    [refresh, schedulePauseFlush],
  )

  const flush = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current)
    interimRef.current = ''
    bufferRef.current.flush()
    refresh()
  }, [refresh])

  const reset = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current)
    interimRef.current = ''
    bufferRef.current.reset()
    setLines([])
  }, [])

  return { lines, liveLineIndex, onFinalFragment, onInterim, flush, reset }
}
