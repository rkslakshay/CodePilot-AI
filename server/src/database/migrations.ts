/** Versioned SQL migrations. Never edit an applied migration — add a new one. */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, key)
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'python' CHECK (language IN ('c','cpp','java','python','javascript','mixed')),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (profile_id, name)
);
CREATE INDEX idx_projects_profile ON projects(profile_id, updated_at DESC);

CREATE TABLE code_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  language TEXT NOT NULL CHECK (language IN ('c','cpp','java','python','javascript')),
  content TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, name)
);
CREATE INDEX idx_files_project ON code_files(project_id, updated_at DESC);
CREATE INDEX idx_files_language ON code_files(language);

-- Unified activity log: generations, conversions, explanations, algorithm runs,
-- executions, debugging operations and learning activities.
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('generation','conversion','explanation','algorithm','execution','debug','learning')),
  title TEXT NOT NULL,
  language TEXT,
  target_language TEXT,
  engine TEXT NOT NULL DEFAULT 'offline' CHECK (engine IN ('ollama','offline','template','local')),
  status TEXT NOT NULL DEFAULT 'success',
  input TEXT NOT NULL DEFAULT '{}',
  output TEXT NOT NULL DEFAULT '{}',
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_history_profile_time ON history(profile_id, created_at DESC);
CREATE INDEX idx_history_kind ON history(kind);
CREATE INDEX idx_history_language ON history(language);

CREATE TABLE saved_algorithms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  algorithm_id TEXT,
  language TEXT,
  code TEXT NOT NULL DEFAULT '',
  pseudocode TEXT NOT NULL DEFAULT '',
  flowchart TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',
  complexity TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_saved_alg_profile ON saved_algorithms(profile_id, created_at DESC);

CREATE TABLE learning_progress (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed')),
  quiz_attempts INTEGER NOT NULL DEFAULT 0,
  quiz_correct INTEGER NOT NULL DEFAULT 0,
  quiz_total INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, topic_id)
);

CREATE TABLE saved_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('viva','mcq','practice')),
  question TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (profile_id, type, question)
);
CREATE INDEX idx_saved_q_topic ON saved_questions(profile_id, topic_id);

CREATE TABLE practice_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('attempted','solved')),
  language TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_practice_profile ON practice_attempts(profile_id, created_at DESC);
`,
  },
  {
    version: 2,
    name: 'learning: per-question quiz answers (revision mode)',
    sql: `
CREATE TABLE quiz_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  question TEXT NOT NULL,
  chosen INTEGER NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0,1)),
  mode TEXT NOT NULL DEFAULT 'quiz' CHECK (mode IN ('quiz','revision')),
  payload TEXT NOT NULL DEFAULT '{}',
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_quiz_answers_q ON quiz_answers(profile_id, question, id DESC);
CREATE INDEX idx_quiz_answers_topic ON quiz_answers(profile_id, topic_id);
`,
  },
  {
    version: 3,
    name: 'repository analyzer',
    sql: `
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  source TEXT NOT NULL CHECK (source IN ('folder','zip')),
  root_path TEXT NOT NULL,
  owned INTEGER NOT NULL DEFAULT 0 CHECK (owned IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','analyzing','analyzed','error')),
  profile TEXT NOT NULL DEFAULT '{}',
  scan_info TEXT NOT NULL DEFAULT '{}',
  analysis TEXT NOT NULL DEFAULT '{}',
  file_count INTEGER NOT NULL DEFAULT 0,
  source_files INTEGER NOT NULL DEFAULT 0,
  loc INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  is_git INTEGER NOT NULL DEFAULT 0 CHECK (is_git IN (0,1)),
  analyzed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_repos_profile ON repositories(profile_id, updated_at DESC);

CREATE TABLE repo_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('source','test','config','doc','style','markup','data','other')),
  size INTEGER NOT NULL DEFAULT 0,
  lines INTEGER NOT NULL DEFAULT 0,
  binary INTEGER NOT NULL DEFAULT 0 CHECK (binary IN (0,1)),
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
  skipped TEXT,
  hash TEXT,
  metrics TEXT NOT NULL DEFAULT '{}',
  UNIQUE (repo_id, path)
);

CREATE TABLE repo_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  path TEXT NOT NULL,
  line INTEGER,
  col INTEGER,
  end_line INTEGER,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  category TEXT NOT NULL CHECK (category IN ('bug','security','complexity','maintainability','performance','style','dependency','debt')),
  rule_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  fix TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  source TEXT NOT NULL CHECK (source IN ('static','tool','ai','combined')),
  tool TEXT NOT NULL DEFAULT 'codepilot',
  snippet TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed','fixed')),
  user_verified INTEGER NOT NULL DEFAULT 0 CHECK (user_verified IN (0,1)),
  note TEXT NOT NULL DEFAULT '',
  present INTEGER NOT NULL DEFAULT 1 CHECK (present IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repo_id, fingerprint)
);
CREATE INDEX idx_findings_repo ON repo_findings(repo_id, severity, category);
CREATE INDEX idx_findings_path ON repo_findings(repo_id, path);

CREATE TABLE repo_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  ecosystem TEXT NOT NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  resolved TEXT,
  dev INTEGER NOT NULL DEFAULT 0 CHECK (dev IN (0,1)),
  direct INTEGER NOT NULL DEFAULT 1 CHECK (direct IN (0,1)),
  manifest TEXT NOT NULL
);
CREATE INDEX idx_deps_repo ON repo_dependencies(repo_id, ecosystem);

CREATE TABLE repo_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('file','folder','repo','function','question','git')),
  target TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('ollama','offline')),
  result TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reviews_lookup ON repo_reviews(repo_id, scope, target, content_hash, model);

CREATE TABLE repo_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_repo_events ON repo_events(repo_id, id DESC);
`,
  },
  {
    version: 4,
    name: 'uml studio diagrams',
    sql: `
CREATE TABLE uml_diagrams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  type TEXT NOT NULL CHECK (type IN ('class','usecase','sequence','activity','state','component','deployment','object')),
  model TEXT NOT NULL,
  renderer TEXT NOT NULL DEFAULT 'codepilot-svg',
  generation TEXT NOT NULL DEFAULT 'manual' CHECK (generation IN ('ai','rules','source','repository','manual','template')),
  repo_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  source_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_uml_profile ON uml_diagrams(profile_id, updated_at DESC);
CREATE INDEX idx_uml_repo ON uml_diagrams(repo_id);
`,
  },
];
