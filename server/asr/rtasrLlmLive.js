import {
  cleanSubtitleDisplay,
  formatLiveSubtitleSentence,
  isProgressiveUtterance,
  pickProgressiveText,
  stripSubtitlePunctuation,
} from './subtitleText.js'
import { extractSpeakerTexts } from './speakerText.js'

const RECENT_STORE_LIMIT = 4

/**
 * 讯飞大模型实时字幕推送：
 * - 中间结果仅 interim 上屏（可改写）
 * - 真正 final / 分片切换 / flush 才落库
 * - 同一句递进结果修订上一段，避免重复
 * - 与近几句比对，隔句复读不再落库
 */
export function createRtasrLlmLiveEmitter({ sendLive, onStoreText, roleSeparation = false }) {
  /** @type {Record<number, { id: number, text: string }>} */
  const activeSegBySpeaker = {}
  /** @type {Record<number, Array<{ display: string, raw: string }>>} */
  const recentStoredBySpeaker = {}
  /** @type {Record<number, string>} */
  const lastLiveBySpeaker = {}
  let currentSpeaker = 1

  function reset() {
    for (const key of Object.keys(activeSegBySpeaker)) delete activeSegBySpeaker[key]
    for (const key of Object.keys(recentStoredBySpeaker)) delete recentStoredBySpeaker[key]
    for (const key of Object.keys(lastLiveBySpeaker)) delete lastLiveBySpeaker[key]
    currentSpeaker = 1
  }

  function getRecent(key) {
    if (!recentStoredBySpeaker[key]) recentStoredBySpeaker[key] = []
    return recentStoredBySpeaker[key]
  }

  function pushRecent(key, display, raw) {
    const list = getRecent(key)
    list.push({ display, raw })
    if (list.length > RECENT_STORE_LIMIT) list.splice(0, list.length - RECENT_STORE_LIMIT)
  }

  function replaceLastRecent(key, display, raw) {
    const list = getRecent(key)
    if (list.length === 0) {
      list.push({ display, raw })
      return
    }
    list[list.length - 1] = { display, raw }
  }

  function emitLive(speaker, text, stable) {
    const raw = String(text || '').trim()
    if (!raw) return
    // 大屏展示保留标点；去重比较仍用无标点 normalize
    const display = formatLiveSubtitleSentence(raw)
    if (!display) return

    const key = speaker > 0 ? speaker : 0
    const compareKey = cleanSubtitleDisplay(display)
    // 中间结果相同可跳过；最终结果即使文案相同也要通知客户端（用于触发上屏）
    if (!stable && lastLiveBySpeaker[key] === compareKey) return
    lastLiveBySpeaker[key] = compareKey

    const spk = speaker > 0 ? speaker : undefined
    sendLive({ text: display, stable, speaker: spk, raw })
  }

  function emitStable(speaker, text) {
    const raw = String(text || '').trim()
    if (!raw) return
    const display = formatLiveSubtitleSentence(raw)
    if (!display) return

    const key = speaker > 0 ? speaker : 0
    const spk = speaker > 0 ? speaker : undefined
    const recent = getRecent(key)

    // 与近几句比对：命中最近一句则修订；命中更早一句则视为复读跳过落库
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      const prev = recent[i]
      if (!isProgressiveUtterance(prev.display, display)) continue

      const mergedDisplay = pickProgressiveText(prev.display, display)
      const useNew =
        mergedDisplay === display ||
        stripSubtitlePunctuation(display).length >= stripSubtitlePunctuation(prev.display).length
      const mergedRaw = useNew ? raw : prev.raw

      if (i === recent.length - 1) {
        replaceLastRecent(key, mergedDisplay, mergedRaw)
        emitLive(speaker, mergedRaw, true)
        if (cleanSubtitleDisplay(mergedDisplay) !== cleanSubtitleDisplay(prev.display)) {
          onStoreText(spk ? `[说话人${spk}] ${mergedRaw}` : mergedRaw, { revise: true })
        }
        return
      }

      // 与更早句子重复/递进：不新增落库，避免报告里隔句复读
      emitLive(speaker, useNew ? mergedRaw : prev.raw, true)
      return
    }

    pushRecent(key, display, raw)
    emitLive(speaker, raw, true)
    onStoreText(spk ? `[说话人${spk}] ${raw}` : raw, { revise: false })
  }

  function adoptSpeakerSeg(speaker, segId, text) {
    const piece = String(text || '').trim()
    if (!piece) return

    const prev = activeSegBySpeaker[speaker]
    if (prev && segId !== prev.id && prev.text.trim()) {
      // 新分片仍是同一句递进：合并，不要半句先落库
      if (isProgressiveUtterance(prev.text, piece)) {
        const useNew =
          cleanSubtitleDisplay(piece).length >= cleanSubtitleDisplay(prev.text).length
        activeSegBySpeaker[speaker] = { id: segId, text: useNew ? piece : prev.text }
        return
      }
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

  return {
    reset,
    flush: () => {
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
          // final 后清掉 active，后续新句用新行
          delete activeSegBySpeaker[spk]
        } else {
          emitLive(spk, current, false)
        }
      }

      if (ls) {
        for (const [speaker, seg] of Object.entries(activeSegBySpeaker)) {
          if (seg.text.trim()) emitStable(Number(speaker), seg.text)
        }
        reset()
      }
    },
  }
}
