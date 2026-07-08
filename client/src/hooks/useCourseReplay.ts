import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PptViewerHandle } from '../components/PptViewer'
import type { LiveSubtitleLine } from './useLiveSubtitle'
import type { TranscriptSegment } from '../types'
import { splitDisplaySentences, stripSubtitlePunctuation } from '../utils/liveSubtitle'

export type SlideEvent = {
  slide_index: number
  event_at_ms: number
}

export type ReplayCue = {
  id: number
  text: string
  startMs: number
  endMs: number
  speaker: number
}

export type ReplayData = {
  slideEvents: SlideEvent[]
  transcript: TranscriptSegment[]
  cues: ReplayCue[]
  durationMs: number
}

const MERGE_GAP_MS = 4000
const MIN_DISPLAY_MS = 3200
const MS_PER_CHAR = 260
const MAX_MERGE_CHARS = 100

export function buildReplayData(
  slideEvents: SlideEvent[],
  transcript: TranscriptSegment[],
): ReplayData {
  const dedupedSlides = dedupeSlideEvents(slideEvents)
  const aligned = alignReplayTimestamps(dedupedSlides, transcript)
  const sortedSlides = [...aligned.slideEvents].sort((a, b) => a.event_at_ms - b.event_at_ms)
  const slideEndMs = sortedSlides.length
    ? Math.max(...sortedSlides.map((e) => e.event_at_ms))
    : 0

  const cues = buildReplayCues(aligned.transcript, slideEndMs)
  const speechEndMs = cues.length ? cues[cues.length - 1].endMs : 0
  let durationMs = Math.max(slideEndMs, speechEndMs, 1000)

  // 字幕整体早于 PPT 结束时，按比例拉长字幕时间轴，避免相对 PPT 过快
  if (slideEndMs > 0 && speechEndMs > 0 && slideEndMs > speechEndMs * 1.08) {
    const scale = slideEndMs / speechEndMs
    const stretched = cues.map((c) => ({
      ...c,
      startMs: c.startMs * scale,
      endMs: c.endMs * scale,
    }))
    durationMs = Math.max(slideEndMs, stretched[stretched.length - 1]?.endMs ?? 0, 1000)
    return {
      slideEvents: sortedSlides,
      transcript: aligned.transcript,
      cues: stretched,
      durationMs,
    }
  }

  return {
    slideEvents: sortedSlides,
    transcript: aligned.transcript,
    cues,
    durationMs,
  }
}

/** 只保留翻页变化点，并补上 t=0 的首页 */
export function dedupeSlideEvents(events: SlideEvent[]): SlideEvent[] {
  if (events.length === 0) return []
  const sorted = [...events].sort((a, b) => a.event_at_ms - b.event_at_ms)
  const result: SlideEvent[] = []
  let lastIndex = -1
  for (const ev of sorted) {
    if (ev.slide_index !== lastIndex) {
      result.push(ev)
      lastIndex = ev.slide_index
    }
  }
  if (result[0].event_at_ms > 0) {
    result.unshift({ slide_index: result[0].slide_index, event_at_ms: 0 })
  }
  return result
}

/** 修正翻页与字幕使用不同时间原点导致的历史数据不同步 */
export function alignReplayTimestamps(
  slideEvents: SlideEvent[],
  transcript: TranscriptSegment[],
): { slideEvents: SlideEvent[]; transcript: TranscriptSegment[] } {
  const finals = transcript.filter((s) => s.is_final && s.text.trim())
  if (slideEvents.length === 0 || finals.length === 0) {
    return { slideEvents, transcript }
  }

  const slideMin = Math.min(...slideEvents.map((e) => e.event_at_ms))
  const slideMax = Math.max(...slideEvents.map((e) => e.event_at_ms))
  const transMin = Math.min(...finals.map((s) => s.start_ms ?? 0))

  // 翻页时间轴已结束，字幕仍在很后面 → 说明录制时用了不同时钟（页面加载 vs 课次开始）
  if (transMin - slideMax > 120_000) {
    const offset = transMin - slideMin
    return {
      slideEvents,
      transcript: transcript.map((s) => ({
        ...s,
        start_ms: s.start_ms != null ? Math.max(0, s.start_ms - offset) : s.start_ms,
        end_ms: s.end_ms != null ? Math.max(0, s.end_ms - offset) : s.end_ms,
      })),
    }
  }

  return { slideEvents, transcript }
}

/** 将 ASR 碎句合并为可读的回放字幕轴（与直播字幕类似的句长与停留） */
export function buildReplayCues(
  segments: TranscriptSegment[],
  slideEndMs = 0,
): ReplayCue[] {
  const finals = segments
    .filter((s) => s.is_final && s.text.trim())
    .sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0))

  if (finals.length === 0) return []

  const groups: TranscriptSegment[][] = []
  let group: TranscriptSegment[] = [finals[0]]

  for (let i = 1; i < finals.length; i++) {
    const prev = finals[i - 1]
    const cur = finals[i]
    const gap = (cur.start_ms ?? 0) - (prev.start_ms ?? 0)
    const mergedLen = group.reduce((n, s) => n + s.text.length, 0) + cur.text.length

    if (gap <= MERGE_GAP_MS && mergedLen <= MAX_MERGE_CHARS) {
      group.push(cur)
    } else {
      groups.push(group)
      group = [cur]
    }
  }
  groups.push(group)

  type DraftCue = { text: string; anchorMs: number }
  const drafts: DraftCue[] = []

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    const nextGroup = groups[gi + 1]
    const groupStart = g[0].start_ms ?? 0
    const groupEndHint = nextGroup
      ? (nextGroup[0].start_ms ?? groupStart)
      : (g[g.length - 1].start_ms ?? groupStart) + MERGE_GAP_MS
    const groupSpan = Math.max(groupEndHint - groupStart, MIN_DISPLAY_MS)

    const merged = stripSubtitlePunctuation(g.map((s) => s.text).join(''))
    const sentences = splitDisplaySentences(merged)
    if (sentences.length === 0) continue

    sentences.forEach((text, idx) => {
      const anchorMs =
        sentences.length === 1
          ? groupStart
          : groupStart + (groupSpan * idx) / sentences.length
      drafts.push({ text, anchorMs })
    })
  }

  if (drafts.length === 0) return []

  const cues: ReplayCue[] = []
  for (let i = 0; i < drafts.length; i++) {
    const { text, anchorMs } = drafts[i]
    const minDuration = Math.max(MIN_DISPLAY_MS, text.length * MS_PER_CHAR)
    const startMs = i === 0 ? anchorMs : Math.max(anchorMs, cues[i - 1].endMs)
    const nextAnchor = drafts[i + 1]?.anchorMs
    const endMs =
      nextAnchor != null
        ? Math.max(startMs + minDuration, nextAnchor)
        : Math.max(startMs + minDuration, slideEndMs || startMs + minDuration)

    cues.push({
      id: i + 1,
      text,
      startMs,
      endMs,
      speaker: 0,
    })
  }

  return cues
}

export function getSlideIndexAtTime(events: SlideEvent[], ms: number): number {
  if (events.length === 0) return 0
  let index = events[0].slide_index
  for (const ev of events) {
    if (ev.event_at_ms <= ms) index = ev.slide_index
    else break
  }
  return index
}

export function getLyricsAtTime(
  segments: TranscriptSegment[],
  ms: number,
): LiveSubtitleLine[] {
  return getLyricsAtTimeFromCues(buildReplayCues(segments), ms)
}

export function getLyricsAtTimeFromCues(cues: ReplayCue[], ms: number): LiveSubtitleLine[] {
  if (cues.length === 0) return []

  let currentIdx = -1
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].startMs <= ms) currentIdx = i
    else break
  }

  return cues.map((cue, i) => ({
    id: cue.id,
    text: cue.text,
    speaker: cue.speaker,
    status: (i < currentIdx ? 'past' : i === currentIdx ? 'current' : 'upcoming') as LiveSubtitleLine['status'],
  }))
}

/** @deprecated 使用 getLyricsAtTime */
export function getSubtitleLinesAtTime(
  segments: TranscriptSegment[],
  ms: number,
): LiveSubtitleLine[] {
  return getLyricsAtTime(segments, ms).filter((l) => l.status !== 'upcoming')
}

export function formatReplayTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

type Options = {
  data: ReplayData | null
  pptRef: React.RefObject<PptViewerHandle | null>
  enabled: boolean
  pptReady: boolean
}

export function useCourseReplay({ data, pptRef, enabled, pptReady }: Options) {
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [speed, setSpeed] = useState(1)
  const lastSlideRef = useRef(-1)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number | null>(null)

  const durationMs = data?.durationMs ?? 0
  const hasTimeline = Boolean(
    data && (data.slideEvents.length > 0 || data.transcript.some((s) => s.is_final)),
  )

  const subtitleLines = useMemo(
    () => (data ? getLyricsAtTimeFromCues(data.cues, currentMs) : []),
    [data, currentMs],
  )

  useEffect(() => {
    if (!enabled || !data || !pptReady) return
    const slide = getSlideIndexAtTime(data.slideEvents, currentMs)
    if (slide === lastSlideRef.current) return
    lastSlideRef.current = slide
    pptRef.current?.goTo(slide)
  }, [currentMs, data, enabled, pptReady, pptRef])

  useEffect(() => {
    if (!playing || !enabled || durationMs <= 0) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTickRef.current = null
      return
    }

    const tick = (now: number) => {
      if (lastTickRef.current == null) {
        lastTickRef.current = now
      } else {
        const delta = (now - lastTickRef.current) * speed
        lastTickRef.current = now
        setCurrentMs((prev) => {
          const next = prev + delta
          if (next >= durationMs) {
            setPlaying(false)
            return durationMs
          }
          return next
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTickRef.current = null
    }
  }, [playing, speed, durationMs, enabled])

  const togglePlay = useCallback(() => {
    if (!hasTimeline) return
    setPlaying((p) => {
      if (!p && currentMs >= durationMs) {
        setCurrentMs(0)
        lastSlideRef.current = -1
      }
      return !p
    })
  }, [hasTimeline, currentMs, durationMs])

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(ms, durationMs))
      setPlaying(false)
      lastSlideRef.current = -1
      setCurrentMs(clamped)
    },
    [durationMs],
  )

  const reset = useCallback(() => {
    setPlaying(false)
    lastSlideRef.current = -1
    setCurrentMs(0)
  }, [])

  return {
    playing,
    currentMs,
    durationMs,
    speed,
    hasTimeline,
    subtitleLines,
    setSpeed,
    togglePlay,
    seek,
    reset,
    pause: () => setPlaying(false),
  }
}
