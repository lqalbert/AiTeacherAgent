import { useCallback, useRef, useState } from 'react'
import { wrapSubtitleLines } from '../utils/movieSubtitle'

const SYNC_DELAY_MS = 120
const MIN_HOLD_MS = 480
const FADE_MS = 180

export type SubtitlePhase = 'idle' | 'in' | 'out'

export function useMovieSubtitle() {
  const [lines, setLines] = useState<string[]>([])
  const [cueKey, setCueKey] = useState(0)
  const [phase, setPhase] = useState<SubtitlePhase>('idle')

  const lastShownAtRef = useRef(0)
  const hasContentRef = useRef(false)
  const cueIdRef = useRef(0)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    syncTimerRef.current = null
    fadeTimerRef.current = null
    holdTimerRef.current = null
  }

  const showWrapped = useCallback((wrapped: string[]) => {
    cueIdRef.current += 1
    setCueKey(cueIdRef.current)
    setLines(wrapped)
    setPhase('in')
    hasContentRef.current = true
    lastShownAtRef.current = Date.now()
  }, [])

  const crossfadeTo = useCallback(
    (wrapped: string[]) => {
      setPhase('out')
      fadeTimerRef.current = setTimeout(() => {
        showWrapped(wrapped)
      }, FADE_MS)
    },
    [showWrapped],
  )

  const onCue = useCallback(
    (text: string) => {
      const wrapped = wrapSubtitleLines(text)
      if (wrapped.length === 0) return

      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => {
        const elapsed = Date.now() - lastShownAtRef.current

        if (!hasContentRef.current) {
          showWrapped(wrapped)
          return
        }

        if (elapsed < MIN_HOLD_MS) {
          if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
          holdTimerRef.current = setTimeout(() => crossfadeTo(wrapped), MIN_HOLD_MS - elapsed)
        } else {
          crossfadeTo(wrapped)
        }
      }, SYNC_DELAY_MS)
    },
    [crossfadeTo, showWrapped],
  )

  const flush = useCallback(() => {
    clearTimers()
  }, [])

  const reset = useCallback(() => {
    clearTimers()
    setLines([])
    setCueKey(0)
    setPhase('idle')
    hasContentRef.current = false
    lastShownAtRef.current = 0
  }, [])

  return { lines, cueKey, phase, onCue, flush, reset }
}
