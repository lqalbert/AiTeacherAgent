import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DEFAULT_AGENT_CONFIG, mergeAgentConfig } from './defaults.js'
import { extractPptxSlideTexts } from '../utils/pptxText.js'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../data')
const LEGACY_CONFIG_PATH = path.join(DATA_DIR, 'agent-config.json')
const LEGACY_KB_DIR = path.join(DATA_DIR, 'knowledge')

function userRoot(userId) {
  if (!userId) throw new Error('缺少用户 ID')
  return path.join(DATA_DIR, 'users', String(userId))
}

function pathsFor(userId) {
  const root = userRoot(userId)
  return {
    root,
    configPath: path.join(root, 'agent-config.json'),
    kbDir: path.join(root, 'knowledge'),
    kbMetaPath: path.join(root, 'knowledge', 'meta.json'),
    kbFilesDir: path.join(root, 'knowledge', 'files'),
  }
}

function ensureUserDirs(userId) {
  const p = pathsFor(userId)
  fs.mkdirSync(p.kbFilesDir, { recursive: true })
  return p
}

function migrateLegacyIfNeeded(userId, p) {
  if (Number(userId) !== 1) return
  if (!fs.existsSync(p.configPath) && fs.existsSync(LEGACY_CONFIG_PATH)) {
    fs.copyFileSync(LEGACY_CONFIG_PATH, p.configPath)
  }
  const legacyMeta = path.join(LEGACY_KB_DIR, 'meta.json')
  const legacyFiles = path.join(LEGACY_KB_DIR, 'files')
  if (!fs.existsSync(p.kbMetaPath) && fs.existsSync(legacyMeta)) {
    fs.copyFileSync(legacyMeta, p.kbMetaPath)
    if (fs.existsSync(legacyFiles)) {
      for (const name of fs.readdirSync(legacyFiles)) {
        const src = path.join(legacyFiles, name)
        const dest = path.join(p.kbFilesDir, name)
        if (!fs.existsSync(dest) && fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest)
        }
      }
    }
  }
}

export function getAgentConfig(userId) {
  const p = ensureUserDirs(userId)
  migrateLegacyIfNeeded(userId, p)
  if (!fs.existsSync(p.configPath)) {
    saveAgentConfig(userId, DEFAULT_AGENT_CONFIG)
    return structuredClone(DEFAULT_AGENT_CONFIG)
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p.configPath, 'utf8'))
    return mergeAgentConfig(raw)
  } catch {
    return structuredClone(DEFAULT_AGENT_CONFIG)
  }
}

export function saveAgentConfig(userId, config) {
  const p = ensureUserDirs(userId)
  const merged = mergeAgentConfig(config)
  fs.writeFileSync(p.configPath, JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

function readKbMeta(userId) {
  const p = ensureUserDirs(userId)
  migrateLegacyIfNeeded(userId, p)
  if (!fs.existsSync(p.kbMetaPath)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(p.kbMetaPath, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeKbMeta(userId, list) {
  const p = ensureUserDirs(userId)
  fs.writeFileSync(p.kbMetaPath, JSON.stringify(list, null, 2), 'utf8')
}

export function listKnowledgeDocs(userId) {
  return readKbMeta(userId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

async function extractKnowledgeText(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase()
  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf8').slice(0, 80000)
  }
  if (ext === '.pdf') {
    const buf = fs.readFileSync(filePath)
    const data = await pdfParse(buf)
    return String(data.text || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 80000)
  }
  if (ext === '.pptx') {
    const slides = await extractPptxSlideTexts(filePath)
    return slides
      .map((t, i) => (t ? `【第${i + 1}页】${t}` : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, 80000)
  }
  return ''
}

export async function addKnowledgeDoc(userId, { title, originalName, diskPath }) {
  const p = ensureUserDirs(userId)
  const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const ext = path.extname(originalName || '').toLowerCase() || path.extname(diskPath)
  const storedName = `${id}${ext}`
  const dest = path.join(p.kbFilesDir, storedName)
  fs.renameSync(diskPath, dest)

  let extractedText = ''
  try {
    extractedText = await extractKnowledgeText(dest, originalName)
  } catch (err) {
    console.warn('[knowledge] extract failed:', err.message)
  }

  const doc = {
    id,
    title: title || originalName || id,
    filename: originalName || storedName,
    storedName,
    createdAt: new Date().toISOString(),
    charCount: extractedText.replace(/\s/g, '').length,
    hasText: Boolean(extractedText.trim()),
  }

  const textPath = path.join(p.kbFilesDir, `${id}.txt`)
  fs.writeFileSync(textPath, extractedText, 'utf8')

  const list = readKbMeta(userId)
  list.push(doc)
  writeKbMeta(userId, list)
  return doc
}

export function deleteKnowledgeDoc(userId, id) {
  const p = ensureUserDirs(userId)
  const list = readKbMeta(userId)
  const doc = list.find((d) => d.id === id)
  if (!doc) return false
  const filePath = path.join(p.kbFilesDir, doc.storedName)
  const textPath = path.join(p.kbFilesDir, `${id}.txt`)
  for (const f of [filePath, textPath]) {
    if (fs.existsSync(f)) fs.unlinkSync(f)
  }
  writeKbMeta(
    userId,
    list.filter((d) => d.id !== id),
  )
  return true
}

export function getKnowledgeCorpus(userId, maxChars = 24000) {
  const p = ensureUserDirs(userId)
  const docs = listKnowledgeDocs(userId)
  const parts = []
  let used = 0
  for (const doc of docs) {
    const textPath = path.join(p.kbFilesDir, `${doc.id}.txt`)
    if (!fs.existsSync(textPath)) continue
    const text = fs.readFileSync(textPath, 'utf8').trim()
    if (!text) continue
    const chunk = `### ${doc.title}\n${text}`
    if (used + chunk.length > maxChars) {
      parts.push(chunk.slice(0, Math.max(0, maxChars - used)))
      break
    }
    parts.push(chunk)
    used += chunk.length
  }
  return parts.join('\n\n')
}
