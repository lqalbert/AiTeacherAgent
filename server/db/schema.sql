CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  ppt_filename TEXT,
  ppt_path TEXT,
  subtitle_style TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  next_round_number INTEGER DEFAULT 2,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lesson_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  round_number INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at_ms INTEGER NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, round_number)
);

CREATE TABLE IF NOT EXISTS slide_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  round_id INTEGER,
  slide_index INTEGER NOT NULL,
  event_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (round_id) REFERENCES lesson_rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  round_id INTEGER,
  slide_index INTEGER DEFAULT 0,
  text TEXT NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  is_final INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (round_id) REFERENCES lesson_rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  round_id INTEGER NOT NULL UNIQUE,
  key_points TEXT,
  difficult_points TEXT,
  summary TEXT,
  difficulty_level INTEGER DEFAULT 3,
  knowledge_tags TEXT,
  mind_map TEXT,
  lesson_evaluation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (round_id) REFERENCES lesson_rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generated_questions (
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

CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_questions_session ON generated_questions(session_id);
CREATE INDEX IF NOT EXISTS idx_slide_events_session ON slide_events(session_id);
CREATE INDEX IF NOT EXISTS idx_lesson_rounds_session ON lesson_rounds(session_id);
