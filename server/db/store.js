import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { joinTranscriptSegments, joinTranscriptText } from '../utils/transcriptText.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../data')
const DB_PATH = path.join(DATA_DIR, 'classroom.db')
const SCHEMA_PATH = path.join(__dirname, 'schema.sql')

let db

function migrateAnalysisTables(dbConn) {
  const analysisCols = dbConn.prepare(`PRAGMA table_info(analysis_results)`).all()
  if (analysisCols.some((c) => c.name === 'round_id')) return

  dbConn.exec(`
    CREATE TABLE analysis_results_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      round_id INTEGER NOT NULL UNIQUE,
      key_points TEXT,
      difficult_points TEXT,
      summary TEXT,
      difficulty_level INTEGER DEFAULT 3,
      knowledge_tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (round_id) REFERENCES lesson_rounds(id) ON DELETE CASCADE
    );

    INSERT INTO analysis_results_new (session_id, round_id, key_points, difficult_points, summary, difficulty_level, knowledge_tags, created_at)
    SELECT ar.session_id, lr.id, ar.key_points, ar.difficult_points, ar.summary, ar.difficulty_level, ar.knowledge_tags, ar.created_at
    FROM analysis_results ar
    JOIN lesson_rounds lr ON lr.session_id = ar.session_id AND lr.round_number = 1;

    DROP TABLE analysis_results;
    ALTER TABLE analysis_results_new RENAME TO analysis_results;
    CREATE INDEX IF NOT EXISTS idx_analysis_round ON analysis_results(round_id);
  `)

  dbConn.exec(`
    CREATE TABLE generated_questions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      round_id INTEGER NOT NULL,
      question_type TEXT NOT NULL,
      stem TEXT NOT NULL,
      options TEXT,
      answer TEXT NOT NULL,
      explanation TEXT,
      difficulty INTEGER DEFAULT 3,
      knowledge_tag TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (round_id) REFERENCES lesson_rounds(id) ON DELETE CASCADE
    );

    INSERT INTO generated_questions_new (session_id, round_id, question_type, stem, options, answer, explanation, difficulty, knowledge_tag, sort_order, created_at)
    SELECT gq.session_id, lr.id, gq.question_type, gq.stem, gq.options, gq.answer, gq.explanation, gq.difficulty, gq.knowledge_tag, gq.sort_order, gq.created_at
    FROM generated_questions gq
    JOIN lesson_rounds lr ON lr.session_id = gq.session_id AND lr.round_number = 1;

    DROP TABLE generated_questions;
    ALTER TABLE generated_questions_new RENAME TO generated_questions;
    CREATE INDEX IF NOT EXISTS idx_questions_round ON generated_questions(round_id);
  `)
}

function runMigrations(dbConn) {
  const transcriptCols = dbConn.prepare(`PRAGMA table_info(transcript_segments)`).all()
  if (!transcriptCols.some((c) => c.name === 'round_id')) {
    dbConn.exec(`ALTER TABLE transcript_segments ADD COLUMN round_id INTEGER`)
  }
  const slideCols = dbConn.prepare(`PRAGMA table_info(slide_events)`).all()
  if (!slideCols.some((c) => c.name === 'round_id')) {
    dbConn.exec(`ALTER TABLE slide_events ADD COLUMN round_id INTEGER`)
  }

  dbConn.exec(`
    CREATE INDEX IF NOT EXISTS idx_transcript_round ON transcript_segments(round_id);
    CREATE INDEX IF NOT EXISTS idx_slide_events_round ON slide_events(round_id);
  `)

  const sessions = dbConn.prepare(`SELECT id, status, started_at, ended_at FROM sessions`).all()
  for (const s of sessions) {
    const hasRound = dbConn
      .prepare(`SELECT 1 FROM lesson_rounds WHERE session_id = ? LIMIT 1`)
      .get(s.id)
    if (hasRound) continue

    const roundStatus = s.status === 'ended' ? 'ended' : 'active'
    const startedMs = Date.parse(String(s.started_at).replace(' ', 'T') + 'Z') || Date.now()
    const result = dbConn
      .prepare(
        `INSERT INTO lesson_rounds (session_id, round_number, status, started_at, started_at_ms, ended_at)
         VALUES (?, 1, ?, ?, ?, ?)`,
      )
      .run(s.id, roundStatus, s.started_at, startedMs, s.ended_at || null)
    const roundId = result.lastInsertRowid
    dbConn
      .prepare(`UPDATE transcript_segments SET round_id = ? WHERE session_id = ? AND round_id IS NULL`)
      .run(roundId, s.id)
    dbConn
      .prepare(`UPDATE slide_events SET round_id = ? WHERE session_id = ? AND round_id IS NULL`)
      .run(roundId, s.id)
  }

  migrateAnalysisTables(dbConn)

  const analysisCols = dbConn.prepare(`PRAGMA table_info(analysis_results)`).all()
  if (!analysisCols.some((c) => c.name === 'mind_map')) {
    dbConn.exec(`ALTER TABLE analysis_results ADD COLUMN mind_map TEXT`)
  }
  if (!analysisCols.some((c) => c.name === 'lesson_evaluation')) {
    dbConn.exec(`ALTER TABLE analysis_results ADD COLUMN lesson_evaluation TEXT`)
  }

  dbConn.exec(`
    CREATE INDEX IF NOT EXISTS idx_questions_round ON generated_questions(round_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_round ON analysis_results(round_id);
  `)

  const sessionCols = dbConn.prepare(`PRAGMA table_info(sessions)`).all()
  if (!sessionCols.some((c) => c.name === 'next_round_number')) {
    dbConn.exec(`ALTER TABLE sessions ADD COLUMN next_round_number INTEGER`)
    const allSessions = dbConn.prepare('SELECT id FROM sessions').all()
    for (const s of allSessions) {
      const max = dbConn
        .prepare('SELECT MAX(round_number) AS m FROM lesson_rounds WHERE session_id = ?')
        .get(s.id)
      dbConn
        .prepare('UPDATE sessions SET next_round_number = ? WHERE id = ?')
        .run((max?.m ?? 0) + 1, s.id)
    }
  }

  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username_hash TEXT NOT NULL UNIQUE,
      username_cipher TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
  `)

  const sessionCols2 = dbConn.prepare(`PRAGMA table_info(sessions)`).all()
  if (!sessionCols2.some((c) => c.name === 'user_id')) {
    dbConn.exec(`ALTER TABLE sessions ADD COLUMN user_id INTEGER`)
  }
}

export function getDb() {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
    db.exec(schema)
    runMigrations(db)
  }
  return db
}

function getRound(id) {
  return getDb().prepare('SELECT * FROM lesson_rounds WHERE id = ?').get(id)
}

export function listRounds(sessionId) {
  return getDb()
    .prepare('SELECT * FROM lesson_rounds WHERE session_id = ? ORDER BY round_number ASC')
    .all(sessionId)
}

export function listRoundsSummary(sessionId) {
  return getDb()
    .prepare(
      `SELECT lr.*,
        (SELECT COUNT(*) FROM transcript_segments t WHERE t.round_id = lr.id) AS segment_count,
        (SELECT 1 FROM analysis_results ar WHERE ar.round_id = lr.id LIMIT 1) AS has_analysis
       FROM lesson_rounds lr
       WHERE lr.session_id = ?
       ORDER BY lr.round_number ASC`,
    )
    .all(sessionId)
    .map((row) => ({
      ...row,
      segment_count: row.segment_count ?? 0,
      has_analysis: Boolean(row.has_analysis),
    }))
}

export function getActiveRound(sessionId) {
  return getDb()
    .prepare(
      `SELECT * FROM lesson_rounds WHERE session_id = ? AND status = 'active'
       ORDER BY round_number DESC LIMIT 1`,
    )
    .get(sessionId)
}

export function getLatestRound(sessionId) {
  return getDb()
    .prepare(
      `SELECT * FROM lesson_rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT 1`,
    )
    .get(sessionId)
}

export function getRoundByNumber(sessionId, roundNumber) {
  return getDb()
    .prepare('SELECT * FROM lesson_rounds WHERE session_id = ? AND round_number = ?')
    .get(sessionId, roundNumber)
}

function createRound(sessionId, roundNumber) {
  const startedMs = Date.now()
  const result = getDb()
    .prepare(
      `INSERT INTO lesson_rounds (session_id, round_number, status, started_at, started_at_ms)
       VALUES (?, ?, 'active', datetime('now'), ?)`,
    )
    .run(sessionId, roundNumber, startedMs)
  return getRound(result.lastInsertRowid)
}

function resolveRoundId(sessionId, roundId) {
  if (roundId) return roundId
  const active = getActiveRound(sessionId)
  if (active) return active.id
  const latest = getLatestRound(sessionId)
  return latest?.id ?? null
}

export function getLatestEndedRound(sessionId) {
  return getDb()
    .prepare(
      `SELECT * FROM lesson_rounds WHERE session_id = ? AND status = 'ended'
       ORDER BY round_number DESC LIMIT 1`,
    )
    .get(sessionId)
}

function enrichSession(session) {
  if (!session) return session
  const rounds = listRounds(session.id)
  const activeRound = rounds.find((r) => r.status === 'active')
  const latestRound = rounds[rounds.length - 1]
  const currentRound = activeRound || latestRound
  const endedRoundCount = rounds.filter((r) => r.status === 'ended').length
  const maxRoundNumber =
    rounds.length > 0 ? Math.max(...rounds.map((r) => r.round_number)) : 0
  const nextRoundNumber = session.next_round_number ?? maxRoundNumber + 1
  return {
    ...session,
    current_round: currentRound?.round_number ?? 1,
    round_count: rounds.length,
    ended_round_count: endedRoundCount,
    next_round_number: nextRoundNumber,
    active_round_id: activeRound?.id ?? null,
    rounds: listRoundsSummary(session.id),
  }
}

export function listSessions(userId) {
  const rows = getDb()
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM transcript_segments t WHERE t.session_id = s.id) AS segment_count,
        (SELECT 1 FROM analysis_results ar
           JOIN lesson_rounds lr ON lr.id = ar.round_id
           WHERE lr.session_id = s.id LIMIT 1) AS has_analysis
       FROM sessions s
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC`,
    )
    .all(userId)
  return rows.map((row) => {
    const enriched = enrichSession(row)
    return {
      ...enriched,
      segment_count: row.segment_count ?? 0,
      has_analysis: Boolean(row.has_analysis),
    }
  })
}

export function getSession(id) {
  const session = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  return enrichSession(session)
}

export function createSession({ title, pptFilename, pptPath, subtitleStyle, userId }) {
  if (!userId) throw new Error('缺少用户信息')
  const result = getDb()
    .prepare(
      `INSERT INTO sessions (title, ppt_filename, ppt_path, subtitle_style, next_round_number, user_id)
       VALUES (?, ?, ?, ?, 2, ?)`,
    )
    .run(
      title,
      pptFilename || null,
      pptPath || null,
      JSON.stringify(subtitleStyle || {}),
      userId,
    )
  const sessionId = result.lastInsertRowid
  createRound(sessionId, 1)
  return getSession(sessionId)
}

export function findUserByUsernameHash(usernameHash) {
  return getDb().prepare('SELECT * FROM users WHERE username_hash = ?').get(usernameHash)
}

export function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)
}

export function createUser({ usernameHash, usernameCipher, passwordHash }) {
  const result = getDb()
    .prepare(
      `INSERT INTO users (username_hash, username_cipher, password_hash) VALUES (?, ?, ?)`,
    )
    .run(usernameHash, usernameCipher, passwordHash)
  return getUserById(result.lastInsertRowid)
}

export function createAuthToken(userId, token, expiresAt) {
  getDb()
    .prepare(`INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, userId, expiresAt)
}

export function getAuthToken(token) {
  return getDb()
    .prepare(
      `SELECT t.*, u.username_cipher
       FROM auth_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token = ?`,
    )
    .get(token)
}

export function deleteAuthToken(token) {
  getDb().prepare(`DELETE FROM auth_tokens WHERE token = ?`).run(token)
}

export function deleteAuthTokensForUser(userId) {
  getDb().prepare(`DELETE FROM auth_tokens WHERE user_id = ?`).run(userId)
}

/** 将历史无主课次挂到指定用户（迁移用） */
export function assignOrphanSessionsToUser(userId) {
  getDb().prepare(`UPDATE sessions SET user_id = ? WHERE user_id IS NULL`).run(userId)
}

export function updateSessionSubtitleStyle(id, subtitleStyle) {
  getDb()
    .prepare('UPDATE sessions SET subtitle_style = ? WHERE id = ?')
    .run(JSON.stringify(subtitleStyle), id)
}

export function endSession(id) {
  const round = getActiveRound(id)
  if (round) {
    getDb()
      .prepare(
        `UPDATE lesson_rounds SET status = 'ended', ended_at = datetime('now') WHERE id = ?`,
      )
      .run(round.id)
  }
  getDb()
    .prepare(`UPDATE sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`)
    .run(id)
  return { session: getSession(id), endedRound: round }
}

export function continueSession(id) {
  const session = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) return null
  if (session.status !== 'ended') {
    throw new Error('当前课程尚未结束，无法开始新课次')
  }
  const maxRound = getDb()
    .prepare('SELECT MAX(round_number) AS m FROM lesson_rounds WHERE session_id = ?')
    .get(id)
  const nextNumber =
    session.next_round_number ?? (maxRound?.m ?? 0) + 1
  createRound(id, nextNumber)
  getDb()
    .prepare(
      `UPDATE sessions SET status = 'active', ended_at = NULL, next_round_number = ? WHERE id = ?`,
    )
    .run(nextNumber + 1, id)
  return getSession(id)
}

export function deleteSession(id) {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function deleteRound(sessionId, roundNumber) {
  const session = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId)
  if (!session) return null

  const round = getRoundByNumber(sessionId, roundNumber)
  if (!round) throw new Error('课次不存在')

  const { c: roundCount } = getDb()
    .prepare('SELECT COUNT(*) AS c FROM lesson_rounds WHERE session_id = ?')
    .get(sessionId)
  if (roundCount <= 1) {
    throw new Error('至少保留一节课，请删除整个课程')
  }

  if (round.status === 'active') {
    throw new Error('进行中的课次无法删除，请先结束本节')
  }

  getDb().prepare('DELETE FROM lesson_rounds WHERE id = ?').run(round.id)

  const activeRound = getActiveRound(sessionId)
  if (!activeRound && session.status === 'active') {
    getDb()
      .prepare(`UPDATE sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`)
      .run(sessionId)
  }

  return getSession(sessionId)
}

export function addSlideEvent(sessionId, slideIndex, eventAtMs, roundId) {
  const rid = resolveRoundId(sessionId, roundId)
  if (!rid) return
  getDb()
    .prepare(
      'INSERT INTO slide_events (session_id, round_id, slide_index, event_at_ms) VALUES (?, ?, ?, ?)',
    )
    .run(sessionId, rid, slideIndex, eventAtMs)
}

export function getSlideEvents(sessionId, roundId = null) {
  if (roundId) {
    return getDb()
      .prepare('SELECT * FROM slide_events WHERE round_id = ? ORDER BY event_at_ms ASC')
      .all(roundId)
  }
  return getDb()
    .prepare('SELECT * FROM slide_events WHERE session_id = ? ORDER BY event_at_ms ASC')
    .all(sessionId)
}

export function addTranscriptSegment({ sessionId, roundId, slideIndex, text, startMs, endMs, isFinal }) {
  const rid = resolveRoundId(sessionId, roundId)
  if (!rid) return null
  const result = getDb()
    .prepare(
      `INSERT INTO transcript_segments (session_id, round_id, slide_index, text, start_ms, end_ms, is_final)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, rid, slideIndex ?? 0, text, startMs ?? null, endMs ?? null, isFinal ? 1 : 0)
  return result.lastInsertRowid
}

export function updateTranscriptSegmentText(segmentId, text) {
  if (!segmentId || text == null) return false
  const result = getDb()
    .prepare(`UPDATE transcript_segments SET text = ? WHERE id = ?`)
    .run(String(text), segmentId)
  return result.changes > 0
}

export function getTranscriptSegments(sessionId, roundId = null) {
  if (roundId) {
    return getDb()
      .prepare('SELECT * FROM transcript_segments WHERE round_id = ? ORDER BY id ASC')
      .all(roundId)
  }
  return getDb()
    .prepare('SELECT * FROM transcript_segments WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId)
}

export function getFullTranscriptText(sessionId, roundId = null) {
  const segments = getTranscriptSegments(sessionId, roundId).filter((s) => s.is_final)
  return joinTranscriptSegments(segments)
}

export function getTranscriptBySlide(sessionId, roundId = null) {
  const segments = getTranscriptSegments(sessionId, roundId).filter((s) => s.is_final)
  const bySlide = new Map()
  for (const seg of segments) {
    const key = seg.slide_index ?? 0
    if (!bySlide.has(key)) bySlide.set(key, [])
    bySlide.get(key).push(seg.text)
  }
  return Object.fromEntries(
    [...bySlide.entries()].map(([slide, texts]) => [slide, joinTranscriptText(texts)]),
  )
}

export function saveAnalysis(sessionId, roundId, analysis) {
  getDb()
    .prepare(
      `INSERT INTO analysis_results (session_id, round_id, key_points, difficult_points, summary, difficulty_level, knowledge_tags, mind_map, lesson_evaluation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_id) DO UPDATE SET
         key_points = excluded.key_points,
         difficult_points = excluded.difficult_points,
         summary = excluded.summary,
         difficulty_level = excluded.difficulty_level,
         knowledge_tags = excluded.knowledge_tags,
         mind_map = excluded.mind_map,
         lesson_evaluation = excluded.lesson_evaluation,
         created_at = datetime('now')`,
    )
    .run(
      sessionId,
      roundId,
      JSON.stringify(analysis.keyPoints || []),
      JSON.stringify(analysis.difficultPoints || []),
      analysis.summary || '',
      analysis.difficultyLevel ?? 3,
      JSON.stringify(analysis.knowledgeTags || []),
      JSON.stringify(analysis.mindMap || null),
      JSON.stringify(analysis.evaluation || null),
    )
}

export function getAnalysis(sessionId, roundId) {
  if (!roundId) return null
  const row = getDb().prepare('SELECT * FROM analysis_results WHERE round_id = ?').get(roundId)
  if (!row) return null
  let mindMap = null
  if (row.mind_map) {
    try {
      mindMap = JSON.parse(row.mind_map)
    } catch {
      mindMap = null
    }
  }
  let evaluation = null
  if (row.lesson_evaluation) {
    try {
      evaluation = JSON.parse(row.lesson_evaluation)
    } catch {
      evaluation = null
    }
  }
  return {
    keyPoints: JSON.parse(row.key_points || '[]'),
    difficultPoints: JSON.parse(row.difficult_points || '[]'),
    summary: row.summary || '',
    difficultyLevel: row.difficulty_level ?? 3,
    knowledgeTags: JSON.parse(row.knowledge_tags || '[]'),
    mindMap,
    evaluation,
    createdAt: row.created_at,
  }
}

export function saveQuestions(sessionId, roundId, questions) {
  const dbConn = getDb()
  const del = dbConn.prepare('DELETE FROM generated_questions WHERE round_id = ?')
  const ins = dbConn.prepare(
    `INSERT INTO generated_questions
      (session_id, round_id, question_type, stem, options, answer, explanation, difficulty, knowledge_tag, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const tx = dbConn.transaction((items) => {
    del.run(roundId)
    items.forEach((q, i) => {
      ins.run(
        sessionId,
        roundId,
        q.questionType,
        q.stem,
        JSON.stringify(q.options || null),
        q.answer,
        q.explanation || '',
        q.difficulty ?? 3,
        q.knowledgeTag || '',
        i,
      )
    })
  })
  tx(questions)
}

export function getQuestions(sessionId, roundId) {
  if (!roundId) return []
  const rows = getDb()
    .prepare('SELECT * FROM generated_questions WHERE round_id = ? ORDER BY sort_order ASC')
    .all(roundId)
  return rows.map((r) => ({
    id: r.id,
    questionType: r.question_type,
    stem: r.stem,
    options: r.options ? JSON.parse(r.options) : null,
    answer: r.answer,
    explanation: r.explanation,
    difficulty: r.difficulty,
    knowledgeTag: r.knowledge_tag,
  }))
}

export function getReport(sessionId, roundNumber = null) {
  const session = getSession(sessionId)
  if (!session) return null

  const rounds = listRoundsSummary(sessionId)
  let round
  if (roundNumber != null && Number.isInteger(roundNumber)) {
    round = getRoundByNumber(sessionId, roundNumber)
  } else {
    round =
      getLatestEndedRound(sessionId) ||
      (session.status === 'ended' ? getLatestRound(sessionId) : null) ||
      getActiveRound(sessionId) ||
      getLatestRound(sessionId)
  }

  const roundId = round?.id ?? null

  return {
    session: {
      ...session,
      subtitle_style: JSON.parse(session.subtitle_style || '{}'),
    },
    rounds,
    currentRound: round,
    transcript: roundId ? getTranscriptSegments(sessionId, roundId) : [],
    slideEvents: roundId ? getSlideEvents(sessionId, roundId) : [],
    analysis: getAnalysis(sessionId, roundId),
    questions: getQuestions(sessionId, roundId),
  }
}

export { getActiveRound as getActiveRoundForSession }
