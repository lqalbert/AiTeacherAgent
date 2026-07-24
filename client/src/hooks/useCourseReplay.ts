import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PptViewerHandle } from '../components/PptViewer'
import type { LiveSubtitleLine } from './useLiveSubtitle'
import type { TranscriptSegment } from '../types'
import {
  extractCompleteSentences,
  formatLiveSubtitleSentence,
  isProgressiveUtterance,
  pickProgressiveOriginal,
  stripSubtitlePunctuation,
} from '../utils/liveSubtitle'

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
  slideIndex?: number
}

export type ReplayData = {
  slideEvents: SlideEvent[]
  transcript: TranscriptSegment[]
  cues: ReplayCue[]
  durationMs: number
}

/** 同一页内碎句合并的最大间隔 */
const MERGE_GAP_MS = 2500
const MIN_CUE_MS = 1200
const MAX_CUE_MS = 8000
const MS_PER_CHAR = 160

export function buildReplayData(
  slideEvents: SlideEvent[],
  transcript: TranscriptSegment[],
): ReplayData {
  const dedupedSlides = dedupeSlideEvents(slideEvents)
  const aligned = alignReplayTimestamps(dedupedSlides, transcript)
  const sortedSlides = [...aligned.slideEvents].sort((a, b) => a.event_at_ms - b.event_at_ms)
  const cues = buildReplayCues(aligned.transcript, sortedSlides)

  const slideEndMs = sortedSlides.length
    ? Math.max(...sortedSlides.map((e) => e.event_at_ms))
    : 0
  const speechEndMs = cues.length ? Math.max(...cues.map((c) => c.endMs)) : 0
  // 总时长取翻页/字幕较晚者；不再缩放字幕轴（缩放会破坏与翻页的对齐）
  const durationMs = Math.max(slideEndMs, speechEndMs, 1000) + 800

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
  const transMax = Math.max(...finals.map((s) => s.start_ms ?? 0))

  // 字幕整体远晚于翻页结束 → 减去偏移，对齐到同一原点
  if (transMin - slideMax > 60_000) {
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

  // 翻页整体远晚于字幕 → 平移翻页时间轴
  if (slideMin - transMax > 60_000) {
    const offset = slideMin - Math.min(transMin, 0)
    return {
      slideEvents: slideEvents.map((e) => ({
        ...e,
        event_at_ms: Math.max(0, e.event_at_ms - offset),
      })),
      transcript,
    }
  }

  return { slideEvents, transcript }
}

function preferredSlideIndex(seg: TranscriptSegment, slideEvents: SlideEvent[]): number {
  if (typeof seg.slide_index === 'number' && seg.slide_index >= 0) return seg.slide_index
  return getSlideIndexAtTime(slideEvents, seg.start_ms ?? 0)
}

/**
 * 按真实转写时间轴生成回放字幕。
 * 关键：cue.startMs 必须贴近 ASR start_ms，禁止被前一句「最短展示时长」往后推，否则会与翻页错位。
 */
export function buildReplayCues(
  segments: TranscriptSegment[],
  slideEvents: SlideEvent[] = [],
): ReplayCue[] {
  const finals = segments
    .filter((s) => {
      // DB 存 0/1；非 0 视为终句
      return s.is_final !== 0 && String(s.text || '').trim()
    })
    .sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0))

  if (finals.length === 0) return []

  // 先去重合并递进碎句，保留最早时间戳与页码
  const mergedSegs: Array<{
    text: string
    startMs: number
    endMs: number
    slideIndex: number
  }> = []

  for (const seg of finals) {
    const text = formatLiveSubtitleSentence(seg.text)
    if (!text) continue
    const startMs = Math.max(0, seg.start_ms ?? 0)
    const endMs = Math.max(startMs, seg.end_ms ?? startMs)
    const slideIndex = preferredSlideIndex(seg, slideEvents)
    const prev = mergedSegs[mergedSegs.length - 1]

    if (
      prev &&
      startMs - prev.startMs <= MERGE_GAP_MS &&
      (isProgressiveUtterance(prev.text, text) || prev.slideIndex === slideIndex)
    ) {
      if (isProgressiveUtterance(prev.text, text)) {
        prev.text = pickProgressiveOriginal(prev.text, text)
      } else {
        // 同页相邻碎句：拼成更长文本，稍后再按句切开
        prev.text = `${prev.text}${/[。！？!?…]$/.test(prev.text) ? '' : ''}${text}`
      }
      prev.endMs = Math.max(prev.endMs, endMs)
      continue
    }

    mergedSegs.push({ text, startMs, endMs, slideIndex })
  }

  type Draft = { text: string; startMs: number; slideIndex: number }
  const drafts: Draft[] = []

  for (const seg of mergedSegs) {
    const { sentences, rest } = extractCompleteSentences(seg.text)
    const parts = sentences.length > 0 ? [...sentences, ...(rest ? [rest] : [])] : [seg.text]
    const displayParts = parts
      .map((p) => stripSubtitlePunctuation(p))
      .filter(Boolean)
    if (displayParts.length === 0) continue

    displayParts.forEach((text, idx) => {
      const startMs =
        displayParts.length === 1
          ? seg.startMs
          : seg.startMs +
            Math.floor(((seg.endMs - seg.startMs) * idx) / Math.max(1, displayParts.length))
      drafts.push({ text, startMs, slideIndex: seg.slideIndex })
    })
  }

  // 再去重相邻展示句
  const deduped: Draft[] = []
  for (const d of drafts) {
    const prev = deduped[deduped.length - 1]
    if (prev && isProgressiveUtterance(prev.text, d.text)) {
      prev.text = stripSubtitlePunctuation(pickProgressiveOriginal(prev.text, d.text))
      continue
    }
    deduped.push({ ...d })
  }

  const cues: ReplayCue[] = []
  for (let i = 0; i < deduped.length; i++) {
    const cur = deduped[i]
    const next = deduped[i + 1]
    const ideal = Math.min(MAX_CUE_MS, Math.max(MIN_CUE_MS, cur.text.length * MS_PER_CHAR))
    const startMs = cur.startMs
    // 展示到下一句开始，或 ideal 时长；绝不把下一句的 start 往后挤
    const endMs =
      next != null
        ? Math.max(startMs + 400, Math.min(next.startMs, startMs + ideal))
        : startMs + ideal

    cues.push({
      id: i + 1,
      text: cur.text,
      startMs,
      endMs: Math.max(endMs, startMs + 400),
      speaker: 0,
      slideIndex: cur.slideIndex,
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

/**
 * 回放时按翻页事件切页（老师当时的翻页时间轴）。
 * 不用每条字幕的 slide_index 驱动翻页，避免页码抖动、频繁 goTo 卡死。
 */
export function getReplaySlideAtTime(
  events: SlideEvent[],
  _cues: ReplayCue[],
  ms: number,
): number {
  return getSlideIndexAtTime(events, ms)
}

export function getLyricsAtTime(
  segments: TranscriptSegment[],
  ms: number,
): LiveSubtitleLine[] {
  return getLyricsAtTimeFromCues(buildReplayCues(segments), ms)
}

/** 回放字幕：只返回已出现的句子（最近若干条 + 当前），避免整表重绘卡顿 */
const REPLAY_LYRICS_PAST_LIMIT = 40

export function getLyricsAtTimeFromCues(cues: ReplayCue[], ms: number): LiveSubtitleLine[] {
  if (cues.length === 0) return []

  let currentIdx = -1
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].startMs <= ms) currentIdx = i
    else break
  }

  // 进度还在第一句之前：不显示「暂无」，留给 UI 提示点击播放
  if (currentIdx < 0) return []

  const from = Math.max(0, currentIdx - REPLAY_LYRICS_PAST_LIMIT + 1)
  const slice = cues.slice(from, currentIdx + 1)
  return slice.map((cue, i) => {
    const absoluteIdx = from + i
    return {
      id: cue.id,
      text: cue.text,
      speaker: cue.speaker,
      status: (absoluteIdx < currentIdx
        ? 'past'
        : 'current') as LiveSubtitleLine['status'],
    }
  })
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
  const playingRef = useRef(false)
  const speedRef = useRef(1)
  const currentMsRef = useRef(0)
  const durationMsRef = useRef(0)
  const lastUiFlushRef = useRef(0)

  playingRef.current = playing
  speedRef.current = speed
  currentMsRef.current = currentMs

  const durationMs = data?.durationMs ?? 0
  durationMsRef.current = durationMs

  const hasTimeline = Boolean(
    data && (data.slideEvents.length > 0 || data.cues.length > 0 || data.transcript.length > 0),
  )

  const subtitleLines = useMemo(
    () => (data ? getLyricsAtTimeFromCues(data.cues, currentMs) : []),
    [data, currentMs],
  )

  // 翻页：同步 goTo。切勿在依赖 currentMs 的 effect 里用 setTimeout+cleanup，
  // 否则下一帧 effect 清理会取消尚未执行的 goTo，表现为回放翻页卡住。
  useEffect(() => {
    if (!enabled || !data || !pptReady) return
    const slide = getReplaySlideAtTime(data.slideEvents, data.cues, currentMs)
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

    // 播放循环用 ref，避免每帧 setState 引发整页重绘卡顿；UI 约 10fps 刷新
    const UI_FLUSH_MS = 100

    const tick = (now: number) => {
      if (!playingRef.current) return

      if (lastTickRef.current == null) {
        lastTickRef.current = now
      } else {
        const delta = (now - lastTickRef.current) * speedRef.current
        lastTickRef.current = now
        const next = Math.min(currentMsRef.current + delta, durationMsRef.current)
        currentMsRef.current = next

        const shouldFlush =
          next >= durationMsRef.current ||
          now - lastUiFlushRef.current >= UI_FLUSH_MS

        if (shouldFlush) {
          lastUiFlushRef.current = now
          setCurrentMs(next)
          if (next >= durationMsRef.current) {
            setPlaying(false)
            playingRef.current = false
            return
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    lastUiFlushRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTickRef.current = null
      // 停播时把精确时间刷到 state，避免进度条落后
      setCurrentMs(currentMsRef.current)
    }
  }, [playing, durationMs, enabled])

  const togglePlay = useCallback(() => {
    if (!hasTimeline) return
    setPlaying((p) => {
      if (!p && currentMsRef.current >= durationMsRef.current) {
        currentMsRef.current = 0
        setCurrentMs(0)
        lastSlideRef.current = -1
      }
      playingRef.current = !p
      return !p
    })
  }, [hasTimeline])

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(ms, durationMsRef.current))
    setPlaying(false)
    playingRef.current = false
    lastSlideRef.current = -1
    lastTickRef.current = null
    currentMsRef.current = clamped
    setCurrentMs(clamped)
  }, [])

  const reset = useCallback(() => {
    setPlaying(false)
    playingRef.current = false
    lastSlideRef.current = -1
    currentMsRef.current = 0
    setCurrentMs(0)
  }, [])

  return {
    playing,
    currentMs,
    durationMs,
    speed,
    hasTimeline,
    hasTranscript: Boolean(data?.cues?.length),
    cueCount: data?.cues?.length ?? 0,
    subtitleLines,
    setSpeed,
    togglePlay,
    seek,
    reset,
    pause: () => {
      playingRef.current = false
      setPlaying(false)
    },
  }
}
