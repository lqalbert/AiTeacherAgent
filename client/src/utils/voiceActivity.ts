/** 连续超过该 RMS 视为有声音 */
export const SPEECH_RMS_THRESHOLD = 0.01
/** 连续多少帧有声音才触发「开始说话」 */
export const SPEECH_START_FRAMES = 2
/** 静音多久后断开转写连接（毫秒） */
export const SILENCE_DISCONNECT_MS = 30_000

export function pcmRms(float32: Float32Array): number {
  if (float32.length === 0) return 0
  let sum = 0
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i]
  return Math.sqrt(sum / float32.length)
}
