import { stripSubtitlePunctuation } from './subtitleText.js'
import { extractSpeakerTexts } from './speakerText.js'

/**
 * B 站 AI 字幕推送：
 * - stable 在 st.type=0（isFinal）时发出
 * - 停顿超时兜底，避免长时间无字幕
 * - 开启角色分离时，按 rl 字段分说话人独立推送
 */
export function createRtasrLlmLiveEmitter({ sendLive, onStoreText, roleSeparation = false }) {
  /** @type {Record<number, { id: number, text: string }>} */
  const activeSegBySpeaker = {}
  /** @type {Record<number, string>} */
  const lastEmittedBySpeaker = {}
  let currentSpeaker = 1
  let pauseTimer = null

  const PAUSE_EMIT_MS = 1200

  function reset() {
    if (pauseTimer) {
      clearTimeout(pauseTimer)
      pauseTimer = null
    }
    for (const key of Object.keys(activeSegBySpeaker)) delete activeSegBySpeaker[key]
    for (const key of Object.keys(lastEmittedBySpeaker)) delete lastEmittedBySpeaker[key]
    currentSpeaker = 1
  }

  function emitStable(speaker, text) {
    const raw = String(text || '').trim()
    if (!raw) return
    const display = stripSubtitlePunctuation(raw)
    if (!display || display.length < 2) return
    if (lastEmittedBySpeaker[speaker] === display) return

    lastEmittedBySpeaker[speaker] = display
    const spk = speaker > 0 ? speaker : undefined
    sendLive({ text: display, stable: true, speaker: spk })
    onStoreText(spk ? `[说话人${spk}] ${raw}` : raw)
  }

  function adoptSpeakerSeg(speaker, segId, text) {
    const piece = String(text || '').trim()
    if (!piece) return

    const prev = activeSegBySpeaker[speaker]
    if (!prev || segId !== prev.id) {
      activeSegBySpeaker[speaker] = { id: segId, text: piece }
      return
    }

    activeSegBySpeaker[speaker].text = piece
  }

  function resolveSpeakerSegments(parsed) {
    if (!roleSeparation || !parsed.hasRoleSeparation) {
      return [{ speaker: 0, text: parsed.text }]
    }

    const st = parsed.data?.cn?.st
    if (!st) {
      return parsed.speakerSegments?.length
        ? parsed.speakerSegments
        : [{ speaker: 0, text: parsed.text }]
    }

    const { segments, lastSpeaker } = extractSpeakerTexts(st, currentSpeaker)
    currentSpeaker = lastSpeaker
    return segments.length ? segments : [{ speaker: 0, text: parsed.text }]
  }

  function schedulePauseEmit() {
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = setTimeout(() => {
      pauseTimer = null
      for (const [speaker, seg] of Object.entries(activeSegBySpeaker)) {
        if (seg.text.trim()) emitStable(Number(speaker), seg.text)
      }
    }, PAUSE_EMIT_MS)
  }

  return {
    reset,
    flush: () => {
      if (pauseTimer) {
        clearTimeout(pauseTimer)
        pauseTimer = null
      }
      for (const [speaker, seg] of Object.entries(activeSegBySpeaker)) {
        if (seg.text.trim()) emitStable(Number(speaker), seg.text)
      }
      reset()
    },
    handleResult(parsed) {
      if (!parsed?.text) return

      const segId = parsed.segId ?? parsed.data?.seg_id ?? 0
      const ls = Boolean(parsed.ls ?? parsed.data?.ls)
      const isFinal = Boolean(parsed.isFinal)
      const segments = resolveSpeakerSegments(parsed)

      for (const { speaker, text } of segments) {
        const spk = speaker > 0 ? speaker : 0
        adoptSpeakerSeg(spk, segId, text)
        if (isFinal && activeSegBySpeaker[spk]?.text) {
          emitStable(spk, activeSegBySpeaker[spk].text)
        }
      }

      if (!isFinal && segments.length > 0) {
        schedulePauseEmit()
      } else if (isFinal && pauseTimer) {
        clearTimeout(pauseTimer)
        pauseTimer = null
      }

      if (ls) {
        reset()
      }
    },
  }
}
