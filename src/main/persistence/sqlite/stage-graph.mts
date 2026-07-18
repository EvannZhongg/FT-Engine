import type { DatabaseSync } from 'node:sqlite'
import type {
  CompetitionGroupConfig,
  CompetitionRefereeConfig
} from '../../../shared/contracts/competition.mts'
import { stableDatabaseId } from './ids.mts'

export function readStageGroups(database: DatabaseSync, stageId: string): CompetitionGroupConfig[] {
  const groupRows = database
    .prepare(
      `
      SELECT id, name, referee_count
      FROM competition_groups WHERE stage_id = ? ORDER BY position
    `
    )
    .all(stageId) as Array<{ id: string; name: string; referee_count: number }>
  return groupRows.map((group) => {
    const players = database
      .prepare('SELECT name FROM contestants WHERE group_id = ? ORDER BY position')
      .all(group.id) as Array<{ name: string }>
    const referees = database
      .prepare(
        `
        SELECT r.referee_index, r.name, r.mode,
          MAX(CASE WHEN db.role = 'primary' THEN db.device_id ELSE '' END) AS pri_addr,
          MAX(CASE WHEN db.role = 'secondary' THEN db.device_id ELSE '' END) AS sec_addr
        FROM referees r
        LEFT JOIN device_bindings db ON db.referee_id = r.id
        WHERE r.group_id = ?
        GROUP BY r.id
        ORDER BY r.referee_index
      `
      )
      .all(group.id) as Array<Record<string, string | number>>
    return {
      name: group.name,
      refCount: Number(group.referee_count),
      players: players.map((player) => player.name),
      referees: referees.map((referee) => ({
        index: Number(referee.referee_index),
        name: String(referee.name),
        mode: referee.mode === 'DUAL' ? ('DUAL' as const) : ('SINGLE' as const),
        pri_addr: String(referee.pri_addr || ''),
        sec_addr: String(referee.sec_addr || '')
      }))
    }
  })
}

export function replaceStageGraph(
  database: DatabaseSync,
  competitionId: string,
  stageId: string,
  attempts: number,
  groups: CompetitionGroupConfig[]
): void {
  database.prepare('DELETE FROM competition_groups WHERE stage_id = ?').run(stageId)
  groups.forEach((group, groupPosition) => {
    const groupId = stableDatabaseId(
      competitionId,
      stageId,
      'group',
      String(groupPosition),
      group.name
    )
    database
      .prepare(
        `
        INSERT INTO competition_groups (id, stage_id, name, position, referee_count)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(groupId, stageId, group.name, groupPosition, group.refCount)
    group.players.forEach((playerName, playerPosition) => {
      const contestantId = stableDatabaseId(
        competitionId,
        stageId,
        groupId,
        'contestant',
        String(playerPosition),
        playerName
      )
      database
        .prepare(
          `
          INSERT INTO contestants (id, group_id, name, position, status)
          VALUES (?, ?, ?, ?, 'pending')
        `
        )
        .run(contestantId, groupId, playerName, playerPosition)
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        database
          .prepare(
            `
            INSERT INTO match_sessions (id, contestant_id, attempt_number, status, rule_version)
            VALUES (?, ?, ?, 'pending', 'route-b-v1')
          `
          )
          .run(
            stableDatabaseId(competitionId, stageId, contestantId, 'session', String(attempt)),
            contestantId,
            attempt
          )
      }
    })
    group.referees.forEach((referee) => {
      const refereeId = stableDatabaseId(
        competitionId,
        stageId,
        groupId,
        'referee',
        String(referee.index)
      )
      database
        .prepare(
          `
          INSERT INTO referees (id, group_id, referee_index, name, mode)
          VALUES (?, ?, ?, ?, ?)
        `
        )
        .run(refereeId, groupId, referee.index, referee.name, referee.mode)
      writeDeviceBindings(database, competitionId, stageId, refereeId, referee)
    })
  })
}

export function updateStageBindings(
  database: DatabaseSync,
  competitionId: string,
  stageId: string,
  groups: CompetitionGroupConfig[]
): void {
  for (const group of groups) {
    const row = database
      .prepare('SELECT id FROM competition_groups WHERE stage_id = ? AND name = ? LIMIT 1')
      .get(stageId, group.name) as { id: string } | undefined
    if (!row) throw new Error('COMPETITION_STRUCTURE_LOCKED')
    for (const referee of group.referees) {
      const stored = database
        .prepare('SELECT id FROM referees WHERE group_id = ? AND referee_index = ?')
        .get(row.id, referee.index) as { id: string } | undefined
      if (!stored) throw new Error('COMPETITION_STRUCTURE_LOCKED')
      database.prepare('DELETE FROM device_bindings WHERE referee_id = ?').run(stored.id)
      writeDeviceBindings(database, competitionId, stageId, stored.id, referee)
    }
  }
}

function writeDeviceBindings(
  database: DatabaseSync,
  competitionId: string,
  stageId: string,
  refereeId: string,
  referee: CompetitionRefereeConfig
): void {
  for (const [role, deviceId] of [
    ['primary', referee.pri_addr],
    ['secondary', referee.mode === 'DUAL' ? referee.sec_addr : '']
  ] as const) {
    if (!deviceId) continue
    const transport = deviceId.startsWith('usb:') || deviceId.startsWith('usbport:') ? 'USB' : 'BLE'
    database
      .prepare(
        `
        INSERT INTO device_bindings (id, referee_id, role, device_id, transport)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(
        stableDatabaseId(competitionId, stageId, refereeId, 'device', role),
        refereeId,
        role,
        deviceId,
        transport
      )
  }
}
