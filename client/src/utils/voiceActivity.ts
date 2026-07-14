/** 连续超过该 RMS 视为有声音（略降阈值，减少方言/小声漏检） */
export const SPEECH_RMS_THRESHOLD = 0.006
/** 连续多少帧有声音才触发「开始说话」 */
export const SPEECH_START_FRAMES = 2
/** 静音提示阈值（毫秒）；录课中不再据此断开转写 */
export const SILENCE_DISCONNECT_MS = 60_000

export function pcmRms(float32: Float32Array): number {
  if (float32.length === 0) return 0
  let sum = 0
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i]
  return Math.sqrt(sum / float32.length)
}
