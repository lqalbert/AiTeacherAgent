import path from 'node:path'

/**
 * 修复 multipart 上传时中文文件名乱码（UTF-8 被当成 latin1 解析）。
 * 若已是正常中文则原样返回。
 */
export function decodeUploadFilename(name) {
  if (!name || typeof name !== 'string') return name
  if (/[\u4e00-\u9fff]/.test(name)) return name

  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8')
    if (/[\u4e00-\u9fff]/.test(fixed)) return fixed
  } catch {
    // ignore
  }

  return name
}

export function safeDiskFilename(originalName) {
  const decoded = decodeUploadFilename(originalName)
  const base = path.basename(decoded || 'upload.pptx')
  return `${Date.now()}-${base.replace(/[^\w.\-()\u4e00-\u9fff]/g, '_')}`
}
