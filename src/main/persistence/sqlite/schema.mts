export const LATEST_SCHEMA_VERSION = 4
export const DATABASE_APPLICATION_ID = 0x4654454e

export const SCHEMA_SQL = `
  BEGIN IMMEDIATE;

  CREATE TABLE competitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('FREE', 'TOURNAMENT')),
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'active', 'completed', 'archived')),
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
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'active', 'completed')),
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 20),
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
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'active', 'completed', 'invalidated')),
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
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'active', 'completed', 'invalidated')),
    started_at TEXT,
    completed_at TEXT,
    invalidated_at TEXT,
    rule_version TEXT NOT NULL,
    UNIQUE (contestant_id, attempt_number)
  ) STRICT;

  CREATE TABLE match_session_transitions (
    id TEXT PRIMARY KEY,
    match_session_id TEXT NOT NULL REFERENCES match_sessions(id) ON DELETE CASCADE,
    from_status TEXT NOT NULL
      CHECK (from_status IN ('pending', 'active', 'completed', 'invalidated')),
    to_status TEXT NOT NULL
      CHECK (to_status IN ('pending', 'active', 'completed', 'invalidated')),
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX match_session_transitions_session_time
    ON match_session_transitions(match_session_id, created_at, id);

  CREATE TABLE media_binding_versions (
    id TEXT PRIMARY KEY,
    contestant_id TEXT NOT NULL REFERENCES contestants(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    provider TEXT NOT NULL CHECK (provider IN ('youtube', 'bilibili')),
    media_id TEXT NOT NULL,
    segment TEXT NOT NULL DEFAULT '',
    canonical_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (contestant_id, revision)
  ) STRICT;

  CREATE TABLE media_bindings (
    id TEXT PRIMARY KEY,
    contestant_id TEXT NOT NULL UNIQUE REFERENCES contestants(id) ON DELETE CASCADE,
    current_version_id TEXT NOT NULL UNIQUE
      REFERENCES media_binding_versions(id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TRIGGER media_binding_versions_no_update
  BEFORE UPDATE ON media_binding_versions
  BEGIN
    SELECT RAISE(ABORT, 'MEDIA_BINDING_VERSION_IMMUTABLE');
  END;

  CREATE TRIGGER media_binding_versions_no_delete
  BEFORE DELETE ON media_binding_versions
  WHEN EXISTS (SELECT 1 FROM contestants WHERE id = OLD.contestant_id)
  BEGIN
    SELECT RAISE(ABORT, 'MEDIA_BINDING_VERSION_IMMUTABLE');
  END;

  CREATE TRIGGER media_bindings_version_owner_insert
  BEFORE INSERT ON media_bindings
  WHEN (SELECT contestant_id FROM media_binding_versions WHERE id = NEW.current_version_id)
    <> NEW.contestant_id
  BEGIN
    SELECT RAISE(ABORT, 'MEDIA_BINDING_VERSION_OWNER_MISMATCH');
  END;

  CREATE TRIGGER media_bindings_version_owner_update
  BEFORE UPDATE OF current_version_id, contestant_id ON media_bindings
  WHEN (SELECT contestant_id FROM media_binding_versions WHERE id = NEW.current_version_id)
    <> NEW.contestant_id
  BEGIN
    SELECT RAISE(ABORT, 'MEDIA_BINDING_VERSION_OWNER_MISMATCH');
  END;

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
    media_binding_version_id TEXT REFERENCES media_binding_versions(id),
    media_provider TEXT NOT NULL DEFAULT ''
      CHECK (media_provider IN ('', 'youtube', 'bilibili')),
    media_id TEXT NOT NULL DEFAULT '',
    media_segment TEXT NOT NULL DEFAULT '',
    media_time_ms INTEGER,
    media_sync_status TEXT NOT NULL DEFAULT 'not_ready'
      CHECK (media_sync_status IN (
        'not_ready', 'aligned', 'stale', 'context_mismatch', 'unsupported', 'error'
      )),
    CHECK (
      media_sync_status <> 'aligned' OR (
        media_binding_version_id IS NOT NULL
        AND media_provider <> ''
        AND media_id <> ''
        AND media_time_ms IS NOT NULL
        AND media_time_ms >= 0
      )
    )
  ) STRICT;

  CREATE TRIGGER score_events_media_version_owner
  BEFORE INSERT ON score_events
  WHEN NEW.media_binding_version_id IS NOT NULL AND (
    SELECT contestant_id FROM media_binding_versions
    WHERE id = NEW.media_binding_version_id
  ) <> (
    SELECT contestant_id FROM match_sessions WHERE id = NEW.match_session_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'MEDIA_BINDING_VERSION_OWNER_MISMATCH');
  END;

  CREATE TRIGGER score_events_no_update
  BEFORE UPDATE ON score_events
  BEGIN
    SELECT RAISE(ABORT, 'SCORE_EVENT_IMMUTABLE');
  END;

  CREATE TRIGGER score_events_no_delete
  BEFORE DELETE ON score_events
  WHEN EXISTS (SELECT 1 FROM match_sessions WHERE id = OLD.match_session_id)
    AND EXISTS (SELECT 1 FROM referees WHERE id = OLD.referee_id)
  BEGIN
    SELECT RAISE(ABORT, 'SCORE_EVENT_IMMUTABLE');
  END;
  CREATE INDEX score_events_session_time
    ON score_events(match_session_id, system_time, event_id);

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
