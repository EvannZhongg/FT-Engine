export const LATEST_SCHEMA_VERSION = 1
export const DATABASE_APPLICATION_ID = 0x4654454e

export const SCHEMA_SQL = `
  BEGIN IMMEDIATE;

  CREATE TABLE competitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('FREE', 'TOURNAMENT')),
    status TEXT NOT NULL DEFAULT 'draft',
    event_date TEXT,
    location TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE stages (
    id TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
    UNIQUE (competition_id, position),
    UNIQUE (competition_id, name)
  ) STRICT;

  CREATE TABLE competition_groups (
    id TEXT PRIMARY KEY,
    stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    referee_count INTEGER NOT NULL CHECK (referee_count > 0),
    UNIQUE (stage_id, position),
    UNIQUE (stage_id, name)
  ) STRICT;

  CREATE TABLE contestants (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES competition_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (group_id, position),
    UNIQUE (group_id, name)
  ) STRICT;

  CREATE TABLE referees (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES competition_groups(id) ON DELETE CASCADE,
    referee_index INTEGER NOT NULL CHECK (referee_index > 0),
    name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('SINGLE', 'DUAL')),
    UNIQUE (group_id, referee_index)
  ) STRICT;

  CREATE TABLE device_bindings (
    id TEXT PRIMARY KEY,
    referee_id TEXT NOT NULL REFERENCES referees(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
    device_id TEXT NOT NULL,
    transport TEXT NOT NULL CHECK (transport IN ('BLE', 'USB')),
    UNIQUE (referee_id, role)
  ) STRICT;

  CREATE TABLE match_sessions (
    id TEXT PRIMARY KEY,
    contestant_id TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    invalidated_at TEXT,
    rule_version TEXT NOT NULL,
    UNIQUE (contestant_id, attempt_number)
  ) STRICT;

  CREATE TABLE score_events (
    event_id TEXT PRIMARY KEY,
    match_session_id TEXT NOT NULL REFERENCES match_sessions(id) ON DELETE CASCADE,
    referee_id TEXT NOT NULL REFERENCES referees(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
    event_type INTEGER NOT NULL,
    device_timestamp_ms INTEGER NOT NULL,
    received_at TEXT NOT NULL,
    system_time TEXT NOT NULL,
    total_plus INTEGER NOT NULL,
    total_minus INTEGER NOT NULL,
    current_total INTEGER NOT NULL,
    major_penalty INTEGER NOT NULL DEFAULT 0,
    media_provider TEXT NOT NULL DEFAULT '',
    media_id TEXT NOT NULL DEFAULT '',
    media_time_ms INTEGER,
    media_sync_status TEXT NOT NULL DEFAULT 'not_ready'
  ) STRICT;
  CREATE INDEX score_events_session_time
    ON score_events(match_session_id, system_time, event_id);

  CREATE TABLE media_bindings (
    id TEXT PRIMARY KEY,
    contestant_id TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    media_id TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    UNIQUE (contestant_id, provider)
  ) STRICT;

  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE export_records (
    id TEXT PRIMARY KEY,
    competition_id TEXT REFERENCES competitions(id) ON DELETE SET NULL,
    format TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    output_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE share_drafts (
    id TEXT PRIMARY KEY,
    competition_id TEXT REFERENCES competitions(id) ON DELETE SET NULL,
    snapshot_json TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE upload_tasks (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES share_drafts(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  PRAGMA application_id = ${DATABASE_APPLICATION_ID};
  PRAGMA user_version = ${LATEST_SCHEMA_VERSION};
  COMMIT;
`
