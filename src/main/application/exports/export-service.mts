import { strToU8, zipSync } from 'fflate'
import type {
  DetailExportRequest,
  ExportErrorCode,
  ExportScope,
  ExportSrtMode,
  ReportExportRequest
} from '../../../shared/contracts/export.mts'

export interface ExportScoreEvent {
  eventId: string
  systemTime: string
  totalPlus: number
  totalMinus: number
  currentTotal: number
  majorPenalty: number
}

export interface ExportRefereeEvents {
  index: number
  name: string
  mode: 'SINGLE' | 'DUAL'
  events: ExportScoreEvent[]
}

export interface ExportContestantSnapshot {
  name: string
  referees: ExportRefereeEvents[]
}

export interface ExportGroupSnapshot {
  name: string
  refCount: number
  contestants: ExportContestantSnapshot[]
}

export interface CompetitionExportSnapshot {
  sourceKey: string
  competitionName: string
  groups: ExportGroupSnapshot[]
}

export interface ExportArtifact {
  fileName: string
  mimeType: 'application/zip' | 'text/csv'
  data: Uint8Array
}

export interface ExportRepository {
  getSnapshot(sourceKey: string): CompetitionExportSnapshot | null
}

export interface ExportFileWriter {
  write(outputPath: string, data: Uint8Array): Promise<void>
}

export class ExportServiceError extends Error {
  readonly code: ExportErrorCode

  constructor(code: ExportErrorCode) {
    super(code)
    this.name = 'ExportServiceError'
    this.code = code
  }
}

export class ExportService {
  private readonly repository: ExportRepository
  private readonly fileWriter: ExportFileWriter

  constructor(repository: ExportRepository, fileWriter: ExportFileWriter) {
    this.repository = repository
    this.fileWriter = fileWriter
  }

  buildDetails(request: unknown): ExportArtifact {
    const normalized = normalizeDetailRequest(request)
    const snapshot = this.requireSnapshot(normalized.scope.sourceKey)
    const groups = selectGroups(snapshot, normalized.scope)
    const files: Record<string, Uint8Array> = {}
    const usedGroups = new Set<string>()
    const matchedContestants = new Set<string>()
    const matchedReferees = new Set<number>()
    let eventCount = 0

    for (const group of groups) {
      const groupPath = uniqueFileSegment(group.name, usedGroups, 'Group')
      const usedContestants = new Set<string>()
      for (const contestant of selectContestants(group, normalized.scope)) {
        matchedContestants.add(contestant.name)
        const contestantPath = uniqueFileSegment(contestant.name, usedContestants, 'Contestant')
        for (const referee of selectReferees(contestant, normalized.scope)) {
          matchedReferees.add(referee.index)
          if (referee.events.length === 0) continue
          eventCount += referee.events.length
          if (normalized.includeCsv) {
            files[`${groupPath}/${contestantPath}/Ref${referee.index}_Log.csv`] = encodeCsv(
              buildLogCsv(referee.events)
            )
          }
          if (normalized.includeSrt) {
            files[`${groupPath}/${contestantPath}/Ref${referee.index}_${normalized.srtMode}.srt`] =
              strToU8(buildSrt(referee.events, normalized.srtMode))
          }
        }
      }
    }

    if (
      normalized.scope.contestantNames?.some((name) => !matchedContestants.has(name)) ||
      normalized.scope.refereeIndexes?.some((index) => !matchedReferees.has(index))
    ) {
      throw new ExportServiceError('EXPORT_SCOPE_NOT_FOUND')
    }
    if (eventCount === 0) throw new ExportServiceError('EXPORT_NO_DATA')
    return {
      fileName: `Details_${fileNameFromScope(snapshot, normalized.scope)}.zip`,
      mimeType: 'application/zip',
      data: zipSync(files, { level: 6 })
    }
  }

  buildReport(request: unknown): ExportArtifact {
    const normalized = normalizeReportRequest(request)
    const snapshot = this.requireSnapshot(normalized.sourceKey)
    const matches = snapshot.groups.filter((group) => group.name === normalized.groupName)
    if (matches.length !== 1) throw new ExportServiceError('EXPORT_SCOPE_NOT_FOUND')
    const csv = buildReportCsv(matches[0], normalized)
    return {
      fileName: `${sanitizeFileSegment(matches[0].name, 'Group')}_${normalized.view.toLowerCase()}.csv`,
      mimeType: 'text/csv',
      data: encodeCsv(csv)
    }
  }

  async writeArtifact(artifact: ExportArtifact, outputPath: unknown): Promise<void> {
    if (typeof outputPath !== 'string' || !outputPath.trim() || outputPath.length > 32768) {
      throw new ExportServiceError('EXPORT_REQUEST_INVALID')
    }
    try {
      await this.fileWriter.write(outputPath, artifact.data)
    } catch (error) {
      throw new ExportServiceError(mapWriteError(error))
    }
  }

  private requireSnapshot(sourceKey: string): CompetitionExportSnapshot {
    const snapshot = this.repository.getSnapshot(sourceKey)
    if (!snapshot) throw new ExportServiceError('EXPORT_COMPETITION_NOT_FOUND')
    return snapshot
  }
}

export function buildLogCsv(events: ExportScoreEvent[]): string {
  const normalized = normalizeEvents(events)
  const baseMs = parseSystemTime(normalized[0].systemTime)
  const rows: Array<Array<string | number>> = [
    ['Timestamp', 'Plus', 'Minus', 'Total', 'MajorPenalty']
  ]
  for (const event of normalized) {
    const relativeSeconds = (parseSystemTime(event.systemTime) - baseMs) / 1000
    rows.push([
      relativeSeconds.toFixed(3),
      event.totalPlus,
      event.totalMinus,
      event.currentTotal,
      event.majorPenalty
    ])
  }
  return rows.map(csvRow).join('\n')
}

export function buildSrt(events: ExportScoreEvent[], mode: ExportSrtMode): string {
  const normalized = normalizeEvents(events)
  if (mode !== 'TOTAL' && mode !== 'SPLIT' && mode !== 'REALTIME') {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  const baseMs = parseSystemTime(normalized[0].systemTime)
  const entries =
    mode === 'REALTIME'
      ? buildRealtimeSrtEntries(normalized)
      : buildStateSrtEntries(normalized, mode)
  return entries
    .filter((entry) => entry.text)
    .map(
      (entry, index) =>
        `${index + 1}\n${formatSrtTime(entry.startMs - baseMs)} --> ${formatSrtTime(entry.endMs - baseMs)}\n${entry.text}\n`
    )
    .join('\n')
}

function buildReportCsv(group: ExportGroupSnapshot, request: ReportExportRequest): string {
  const refereeIndexes = Array.from({ length: group.refCount }, (_, index) => index + 1)
  const refereeNames = new Map<number, string>()
  for (const contestant of group.contestants) {
    for (const referee of contestant.referees) {
      if (!refereeNames.has(referee.index)) refereeNames.set(referee.index, referee.name)
    }
  }

  if (request.view === 'RAW') {
    const rows: Array<Array<string | number>> = [
      [
        'Contestant',
        ...refereeIndexes.map((index) => refereeNames.get(index) || `Referee ${index}`),
        'Average Score'
      ]
    ]
    for (const contestant of group.contestants) {
      const scores = refereeIndexes.map((index) => latestScore(contestant, index))
      const average =
        scores.reduce((total, score) => total + (score?.currentTotal || 0), 0) / group.refCount
      rows.push([
        contestant.name,
        ...scores.map((score) =>
          score
            ? `${score.currentTotal} (+${score.totalPlus}/-${score.totalMinus}/-${score.majorPenalty})`
            : '-'
        ),
        average.toFixed(2)
      ])
    }
    return rows.map(csvRow).join('\n')
  }

  const maxima = new Map<number, number>()
  for (const index of refereeIndexes) {
    maxima.set(
      index,
      Math.max(
        0,
        ...group.contestants.map((contestant) => latestScore(contestant, index)?.currentTotal || 0)
      )
    )
  }
  const scoreRows = group.contestants.map((contestant, position) => {
    const scaledScores = refereeIndexes.map((index) => {
      const maximum = maxima.get(index) || 0
      const total = latestScore(contestant, index)?.currentTotal || 0
      return maximum > 0 ? (total / maximum) * request.scaleRatio : 0
    })
    const penalty = request.includePenalty ? standardPenalty(contestant) : 0
    return {
      contestant: contestant.name,
      position,
      scaledScores,
      penalty,
      finalScore: scaledScores.reduce((total, score) => total + score, 0) / group.refCount - penalty
    }
  })
  scoreRows.sort(
    (left, right) => right.finalScore - left.finalScore || left.position - right.position
  )
  const rows: Array<Array<string | number>> = [
    [
      'Rank',
      'Contestant',
      ...refereeIndexes.map((index) => `${refereeNames.get(index) || `Referee ${index}`} (Scaled)`),
      ...(request.includePenalty ? ['Major Penalty'] : []),
      'Final Score'
    ]
  ]
  scoreRows.forEach((row, index) => {
    rows.push([
      index + 1,
      row.contestant,
      ...row.scaledScores.map((score) => score.toFixed(2)),
      ...(request.includePenalty ? [row.penalty] : []),
      row.finalScore.toFixed(2)
    ])
  })
  return rows.map(csvRow).join('\n')
}

function standardPenalty(contestant: ExportContestantSnapshot): number {
  const penalties = contestant.referees
    .filter((referee) => referee.mode === 'DUAL')
    .map((referee) => latestEvent(referee.events)?.majorPenalty || 0)
  if (penalties.length === 0) return 0
  const counts = new Map<number, number>()
  for (const penalty of penalties) counts.set(penalty, (counts.get(penalty) || 0) + 1)
  const maximumFrequency = Math.max(...counts.values())
  return Math.max(
    ...[...counts].filter(([, count]) => count === maximumFrequency).map(([value]) => value)
  )
}

function latestScore(
  contestant: ExportContestantSnapshot,
  refereeIndex: number
): ExportScoreEvent | null {
  const referee = contestant.referees.find((value) => value.index === refereeIndex)
  return referee ? latestEvent(referee.events) : null
}

function latestEvent(events: ExportScoreEvent[]): ExportScoreEvent | null {
  return events.length > 0 ? normalizeEvents(events).at(-1) || null : null
}

interface SrtEntry {
  startMs: number
  endMs: number
  text: string
}

function buildStateSrtEntries(
  events: ExportScoreEvent[],
  mode: Exclude<ExportSrtMode, 'REALTIME'>
): SrtEntry[] {
  const entries: SrtEntry[] = []
  let previous: number | string | null = null
  for (const event of events) {
    const timestamp = parseSystemTime(event.systemTime)
    const comparison =
      mode === 'TOTAL' ? event.currentTotal : `${event.totalPlus}:${event.totalMinus}`
    if (comparison === previous) continue
    const prior = entries.at(-1)
    if (prior && timestamp - prior.startMs < 1000) prior.endMs = timestamp
    entries.push({
      startMs: timestamp,
      endMs: timestamp + 1000,
      text:
        mode === 'TOTAL' ? String(event.currentTotal) : `+${event.totalPlus} / -${event.totalMinus}`
    })
    previous = comparison
  }
  return entries
}

function buildRealtimeSrtEntries(events: ExportScoreEvent[]): SrtEntry[] {
  let previous = { plus: 0, minus: 0 }
  if (Math.abs(events[0].totalPlus) > 1 || Math.abs(events[0].totalMinus) > 1) {
    previous = { plus: events[0].totalPlus, minus: events[0].totalMinus }
  }
  const bursts: Array<{
    startMs: number
    lastMs: number
    plus: number
    minus: number
  }> = []
  for (const event of events) {
    const plus = event.totalPlus - previous.plus
    const minus = event.totalMinus - previous.minus
    previous = { plus: event.totalPlus, minus: event.totalMinus }
    if (plus === 0 && minus === 0) continue
    const timestamp = parseSystemTime(event.systemTime)
    const current = bursts.at(-1)
    if (current && timestamp - current.lastMs < 300) {
      current.plus += plus
      current.minus += minus
      current.lastMs = timestamp
    } else {
      bursts.push({ startMs: timestamp, lastMs: timestamp, plus, minus })
    }
  }
  return bursts.map((burst) => ({
    startMs: burst.startMs,
    endMs: burst.lastMs + 1000,
    text: [burst.plus > 0 ? `+${burst.plus}` : '', burst.minus > 0 ? `-${burst.minus}` : '']
      .filter(Boolean)
      .join(' ')
  }))
}

function selectGroups(
  snapshot: CompetitionExportSnapshot,
  scope: ExportScope
): ExportGroupSnapshot[] {
  const groups = scope.groupNames
    ? snapshot.groups.filter((group) => scope.groupNames?.includes(group.name))
    : snapshot.groups
  if (groups.length === 0 || (scope.groupNames && groups.length !== scope.groupNames.length)) {
    throw new ExportServiceError('EXPORT_SCOPE_NOT_FOUND')
  }
  return groups
}

function selectContestants(
  group: ExportGroupSnapshot,
  scope: ExportScope
): ExportContestantSnapshot[] {
  const contestants = scope.contestantNames
    ? group.contestants.filter((contestant) => scope.contestantNames?.includes(contestant.name))
    : group.contestants
  return contestants
}

function selectReferees(
  contestant: ExportContestantSnapshot,
  scope: ExportScope
): ExportRefereeEvents[] {
  const referees = scope.refereeIndexes
    ? contestant.referees.filter((referee) => scope.refereeIndexes?.includes(referee.index))
    : contestant.referees
  return referees
}

function normalizeDetailRequest(value: unknown): DetailExportRequest {
  if (!isRecord(value) || !isRecord(value.scope)) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  const scope = normalizeScope(value.scope)
  if (
    typeof value.includeCsv !== 'boolean' ||
    typeof value.includeSrt !== 'boolean' ||
    (!value.includeCsv && !value.includeSrt) ||
    (value.srtMode !== 'TOTAL' && value.srtMode !== 'SPLIT' && value.srtMode !== 'REALTIME')
  ) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  return {
    scope,
    includeCsv: value.includeCsv,
    includeSrt: value.includeSrt,
    srtMode: value.srtMode
  }
}

function normalizeReportRequest(value: unknown): ReportExportRequest {
  if (
    !isRecord(value) ||
    (value.view !== 'RAW' && value.view !== 'SCALED') ||
    typeof value.includePenalty !== 'boolean' ||
    typeof value.scaleRatio !== 'number' ||
    !Number.isFinite(value.scaleRatio) ||
    value.scaleRatio < 1 ||
    value.scaleRatio > 100
  ) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  return {
    sourceKey: boundedText(value.sourceKey, 256),
    groupName: boundedText(value.groupName, 128),
    view: value.view,
    scaleRatio: value.scaleRatio,
    includePenalty: value.includePenalty
  }
}

function normalizeScope(value: Record<string, unknown>): ExportScope {
  return {
    sourceKey: boundedText(value.sourceKey, 256),
    groupNames: optionalTextArray(value.groupNames, 64, 128),
    contestantNames: optionalTextArray(value.contestantNames, 2000, 128),
    refereeIndexes: optionalIndexArray(value.refereeIndexes)
  }
}

function normalizeEvents(events: ExportScoreEvent[]): ExportScoreEvent[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new ExportServiceError('EXPORT_DATA_INVALID')
  }
  const normalized = events.map((event) => {
    if (
      !event ||
      typeof event.eventId !== 'string' ||
      !event.eventId ||
      !Number.isFinite(Date.parse(event.systemTime)) ||
      ![event.totalPlus, event.totalMinus, event.currentTotal, event.majorPenalty].every(
        Number.isSafeInteger
      )
    ) {
      throw new ExportServiceError('EXPORT_DATA_INVALID')
    }
    return event
  })
  return normalized.sort(
    (left, right) =>
      parseSystemTime(left.systemTime) - parseSystemTime(right.systemTime) ||
      left.eventId.localeCompare(right.eventId)
  )
}

function optionalTextArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  const normalized = value.map((item) => boundedText(item, maxLength))
  if (new Set(normalized).size !== normalized.length) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  return normalized
}

function optionalIndexArray(value: unknown): number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  if (
    !value.every((item) => Number.isSafeInteger(item) && Number(item) >= 1 && Number(item) <= 1000)
  ) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  const normalized = value.map(Number)
  if (new Set(normalized).size !== normalized.length) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  return normalized
}

function fileNameFromScope(snapshot: CompetitionExportSnapshot, scope: ExportScope): string {
  const value = scope.groupNames?.length === 1 ? scope.groupNames[0] : snapshot.competitionName
  return sanitizeFileSegment(value, 'Competition')
}

function uniqueFileSegment(value: string, used: Set<string>, fallback: string): string {
  const base = sanitizeFileSegment(value, fallback)
  let candidate = base
  let suffix = 2
  while (used.has(candidate.toLowerCase())) candidate = `${base}_${suffix++}`
  used.add(candidate.toLowerCase())
  return candidate
}

function sanitizeFileSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  return (normalized || fallback).slice(0, 96)
}

function encodeCsv(value: string): Uint8Array {
  return strToU8(`\uFEFF${value}`)
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvCell).join(',')
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function parseSystemTime(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new ExportServiceError('EXPORT_DATA_INVALID')
  return parsed
}

function formatSrtTime(relativeMs: number): string {
  const value = Math.max(0, Math.round(relativeMs))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor((value % 3_600_000) / 60_000)
  const seconds = Math.floor((value % 60_000) / 1000)
  const millis = value % 1000
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(millis).padStart(3, '0')}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function boundedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new ExportServiceError('EXPORT_REQUEST_INVALID')
  }
  return value.trim()
}

function mapWriteError(error: unknown): ExportErrorCode {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : ''
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return 'EXPORT_PERMISSION_DENIED'
  }
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'EXPORT_DISK_FULL'
  return 'EXPORT_WRITE_FAILED'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
