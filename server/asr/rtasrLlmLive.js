import { stripSubtitlePunctuation } from './subtitleText.js'
import { extractSpeakerTexts } from './speakerText.js'

/**
 * 讯飞大模型实时字幕推送：
 * - 中间结果 stable=false 立即上屏（可改写）
 * - 最终结果 stable=true 落库并巩固字幕
 * - 分片切换时先落地上一段，避免丢句
 */
export function createRtasrLlmLiveEmitter({ sendLive, onStoreText, roleSeparation = false }) {
  /** @type {Record<number, { id: number, text: string }>} */
  const activeSegBySpeaker = {}
  /** @type {Record<number, string>} */
  const lastStoredBySpeaker = {}
  /** @type {Record<number, string>} */
  const lastLiveBySpeaker = {}
  let currentSpeaker = 1
  let pauseTimer = null

  const PAUSE_EMIT_MS = 900

  function reset() {
    if (pauseTimer) {
      clearTimeout(pauseTimer)
      pauseTimer = null
    }
    for (const key of Object.keys(activeSegBySpeaker)) delete activeSegBySpeaker[key]
    for (const key of Object.keys(lastStoredBySpeaker)) delete lastStoredBySpeaker[key]
    for (const key of Object.keys(lastLiveBySpeaker)) delete lastLiveBySpeaker[key]
    currentSpeaker = 1
  }

  function emitLive(speaker, text, stable) {
    const raw = String(text || '').trim()
    if (!raw) return
    const display = stripSubtitlePunctuation(raw)
    if (!display) return

    const key = speaker > 0 ? speaker : 0
    // 最终结果允许与中间结果相同；中间结果相同则跳过
    if (!stable && lastLiveBySpeaker[key] === display) return
    lastLiveBySpeaker[key] = display

    const spk = speaker > 0 ? speaker : undefined
    sendLive({ text: display, stable, speaker: spk, raw })
  }

  function emitStable(speaker, text) {
    const raw = String(text || '').trim()
    if (!raw) return
    const display = stripSubtitlePunctuation(raw)
    if (!display) return

    const key = speaker > 0 ? speaker : 0
    if (lastStoredBySpeaker[key] === display) {
      // 仍推一次最终态，确保 UI 从 interim 固化
      emitLive(speaker, raw, true)
      return
    }
    lastStoredBySpeaker[key] = display

    emitLive(speaker, raw, true)
    const spk = speaker > 0 ? speaker : undefined
    onStoreText(spk ? `[说话人${spk}] ${raw}` : raw)
  }

  function adoptSpeakerSeg(speaker, segId, text) {
    const piece = String(text || '').trim()
    if (!piece) return

    const prev = activeSegBySpeaker[speaker]
    // 分片切换：先落盘上一段，避免丢句
    if (prev && segId !== prev.id && prev.text.trim()) {
      emitStable(speaker, prev.text)
    }

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
        const current = activeSegBySpeaker[spk]?.text
        if (!current) continue

        if (isFinal) {
          emitStable(spk, current)
        } else {
          // 中间结果立即上屏，减少「漏听感」
          emitLive(spk, current, false)
          schedulePauseEmit()
        }
      }

      if (isFinal && pauseTimer) {
        clearTimeout(pauseTimer)
        pauseTimer = null
      }

      if (ls) {
        // 会话尾帧：落盘残留后重置
        for (const [speaker, seg] of Object.entries(activeSegBySpeaker)) {
          if (seg.text.trim()) emitStable(Number(speaker), seg.text)
        }
        reset()
      }
    },
  }
}
