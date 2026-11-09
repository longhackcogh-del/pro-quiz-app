const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const databaseFile = process.env.DATABASE_FILE || './data/pro-quiz.sqlite';
const resolvedFile = path.resolve(databaseFile);
fs.mkdirSync(path.dirname(resolvedFile), { recursive: true });

const db = new DatabaseSync(resolvedFile);
db.exec('PRAGMA foreign_keys = ON');
const existingQuestionColumns = db.prepare('PRAGMA table_info(questions)').all().map((column) => column.name);
if (existingQuestionColumns.length > 0 && !existingQuestionColumns.includes('source_text')) {
  db.exec('ALTER TABLE questions RENAME TO legacy_questions');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    source_text TEXT NOT NULL,
    answer_index INTEGER,
    answer_status TEXT NOT NULL DEFAULT 'unconfirmed',
    answer_source TEXT NOT NULL DEFAULT 'not_provided',
    ai_suggestion_index INTEGER,
    ai_suggestion_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    option_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    UNIQUE (question_id, option_index)
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    question_order TEXT NOT NULL,
    option_orders TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '{}',
    current_index INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS wrong_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    selected_index INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    UNIQUE (attempt_id, question_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );
`);

// Add ownership without rewriting or discarding the existing shared bank.
const questionColumns = db.prepare('PRAGMA table_info(questions)').all().map(column => column.name);
if (!questionColumns.includes('owner_id') && existingQuestionColumns.length) {
  const backupDirectory = path.join(path.dirname(resolvedFile), 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupFile = path.join(backupDirectory, `before-account-isolation-${Date.now()}.sqlite`);
  db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);
}
db.exec('BEGIN IMMEDIATE');
try {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  if (!questionColumns.includes('owner_id')) db.exec('ALTER TABLE questions ADD COLUMN owner_id TEXT REFERENCES users(id)');
  if (!db.prepare('PRAGMA table_info(attempts)').all().some(column => column.name === 'owner_id')) db.exec('ALTER TABLE attempts ADD COLUMN owner_id TEXT REFERENCES users(id)');
  db.exec('CREATE INDEX IF NOT EXISTS questions_owner ON questions(owner_id, id); CREATE INDEX IF NOT EXISTS attempts_owner ON attempts(owner_id, status, updated_at)');
  db.exec(`CREATE TABLE IF NOT EXISTS question_sets (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100)); CREATE INDEX IF NOT EXISTS question_sets_owner ON question_sets(owner_id);`);
  if (!db.prepare('PRAGMA table_info(questions)').all().some(column => column.name === 'set_id')) db.exec('ALTER TABLE questions ADD COLUMN set_id INTEGER REFERENCES question_sets(id) ON DELETE SET NULL');
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }

module.exports = db;
