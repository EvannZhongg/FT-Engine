import type {
  CompetitionCreateInput,
  CompetitionUpdateInput
} from '../application/competitions/competition-service.mts'
import type { CompetitionExportSnapshot } from '../application/exports/export-service.mts'
import type { AppSettings } from '../application/settings/app-settings.mts'
import type { CompetitionConfig, CompetitionListItem } from '../../shared/contracts/competition.mts'
import type { CompetitionStageConfig, StageConfigInput } from '../../shared/contracts/stage.mts'
import type {
  MediaBinding,
  MediaBindingVersion,
  ParsedMediaUrl
} from '../../shared/media/media-contract.mts'
import { ExportQuery } from './queries/export-query.mts'
import { ReplayQuery, type ReplayEvent } from './queries/replay-query.mts'
import { ReportQuery, type CompetitionReport } from './queries/report-query.mts'
import { CompetitionRepository } from './repositories/competition-repository.mts'
import {
  MatchRepository,
  type MatchScoreEventWrite,
  type MatchScoreEventWriteResult,
  type StoredScoreEvent
} from './repositories/match-repository.mts'
import {
  MatchProgressRepository,
  type MatchProgressContext
} from './repositories/match-progress-repository.mts'
import { SettingsRepository } from './repositories/settings-repository.mts'
import { StageRepository } from './repositories/stage-repository.mts'
import { SqliteConnection } from './sqlite/connection.mts'

export { DATABASE_APPLICATION_ID, LATEST_SCHEMA_VERSION } from './sqlite/schema.mts'
export type {
  MatchScoreEventWrite,
  MatchScoreEventWriteResult,
  StoredScoreEvent
} from './repositories/match-repository.mts'
export type { ReplayEvent } from './queries/replay-query.mts'
export type { CompetitionReport } from './queries/report-query.mts'

export class LocalDatabase {
  private readonly connection: SqliteConnection
  private readonly competitions: CompetitionRepository
  private readonly matches: MatchRepository
  private readonly matchProgress: MatchProgressRepository
  private readonly settings: SettingsRepository
  private readonly stages: StageRepository
  private readonly replay: ReplayQuery
  private readonly reports: ReportQuery
  private readonly exports: ExportQuery

  constructor(databasePath: string, backupRoot: string) {
    this.connection = new SqliteConnection(databasePath, backupRoot)
    this.competitions = new CompetitionRepository(this.connection)
    this.matches = new MatchRepository(this.connection)
    this.matchProgress = new MatchProgressRepository(this.connection)
    this.settings = new SettingsRepository(this.connection)
    this.stages = new StageRepository(this.connection)
    this.replay = new ReplayQuery(this.connection)
    this.reports = new ReportQuery(this.connection, this.competitions)
    this.exports = new ExportQuery(this.connection, this.competitions)
  }

  get databasePath(): string {
    return this.connection.databasePath
  }

  get backupRoot(): string {
    return this.connection.backupRoot
  }

  open(): void {
    this.connection.open()
  }

  close(): void {
    this.connection.close()
  }

  getSchemaVersion(): number {
    return this.connection.getSchemaVersion()
  }

  getApplicationId(): number {
    return this.connection.getApplicationId()
  }

  listTableNames(): string[] {
    return this.connection.listTableNames()
  }

  getAppSettings(): AppSettings {
    return this.settings.get()
  }

  setAppSetting(key: string, value: unknown): AppSettings {
    return this.settings.set(key, value)
  }

  createCompetition(input: CompetitionCreateInput): CompetitionConfig {
    return this.competitions.create(input)
  }

  updateCompetition(sourceKey: string, input: CompetitionUpdateInput): CompetitionConfig {
    return this.competitions.update(sourceKey, input)
  }

  getCompetitionConfig(sourceKey: string): CompetitionConfig | null {
    return this.competitions.getConfig(sourceKey)
  }

  listCompetitionProjects(): CompetitionListItem[] {
    return this.competitions.list()
  }

  deleteCompetition(sourceKey: string): boolean {
    return this.competitions.delete(sourceKey)
  }

  listStages(competitionId: string): CompetitionStageConfig[] {
    return this.stages.list(competitionId)
  }

  createStage(competitionId: string, input: StageConfigInput): CompetitionStageConfig {
    return this.stages.create(competitionId, input)
  }

  updateStage(stageId: string, input: StageConfigInput): CompetitionStageConfig {
    return this.stages.update(stageId, input)
  }

  reorderStages(competitionId: string, stageIds: string[]): CompetitionStageConfig[] {
    return this.stages.reorder(competitionId, stageIds)
  }

  deleteStage(stageId: string): boolean {
    return this.stages.delete(stageId)
  }

  activateStage(stageId: string): CompetitionStageConfig {
    return this.stages.activate(stageId)
  }

  completeStage(stageId: string): CompetitionStageConfig {
    return this.stages.complete(stageId)
  }

  appendFreeContestant(
    stageId: string,
    groupName: string,
    contestantName: string
  ): CompetitionStageConfig {
    return this.stages.appendFreeContestant(stageId, groupName, contestantName)
  }

  hasMatchContext(
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string,
    attemptNumber: number,
    refereeIndexes: number[]
  ): boolean {
    return this.competitions.hasMatchContext(
      sourceKey,
      stageId,
      groupName,
      contestantName,
      attemptNumber,
      refereeIndexes
    )
  }

  appendMatchScoreEvent(input: MatchScoreEventWrite): MatchScoreEventWriteResult {
    return this.matches.appendScoreEvent(input)
  }

  activateMatchSession(context: MatchProgressContext, occurredAt: string): void {
    this.matchProgress.activate(context, occurredAt)
  }

  transitionMatchSession(
    current: MatchProgressContext,
    next: MatchProgressContext,
    occurredAt: string
  ): void {
    this.matchProgress.completeAndActivate(current, next, occurredAt)
  }

  completeMatchSession(context: MatchProgressContext, occurredAt: string): void {
    this.matchProgress.complete(context, occurredAt)
  }

  invalidateMatchSession(context: MatchProgressContext, occurredAt: string): void {
    this.matchProgress.invalidate(context, occurredAt)
  }

  replaceMediaBinding(
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string,
    binding: ParsedMediaUrl
  ): MediaBinding | null {
    return this.matches.replaceMediaBinding(sourceKey, stageId, groupName, contestantName, binding)
  }

  getMediaBinding(
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string
  ): MediaBinding | null {
    return this.matches.getMediaBinding(sourceKey, stageId, groupName, contestantName)
  }

  removeMediaBinding(
    sourceKey: string,
    stageId: string,
    groupName: string,
    contestantName: string
  ): boolean {
    return this.matches.removeMediaBinding(sourceKey, stageId, groupName, contestantName)
  }

  listScoredContestants(
    sourceKey: string,
    stageId: string,
    groupName: string,
    attemptNumber: number
  ): string[] {
    return this.replay.listScoredContestants(sourceKey, stageId, groupName, attemptNumber)
  }

  getReplay(
    sourceKey: string,
    groupName: string,
    contestantName: string
  ): {
    status: 'ok'
    binding: MediaBinding | null
    binding_versions: MediaBindingVersion[]
    events: ReplayEvent[]
  } | null {
    return this.replay.get(sourceKey, groupName, contestantName)
  }

  getReport(sourceKey: string): CompetitionReport | null {
    return this.reports.get(sourceKey)
  }

  getCompetitionExportSnapshot(sourceKey: string): CompetitionExportSnapshot | null {
    return this.exports.getCompetitionSnapshot(sourceKey)
  }

  getScoreEvents(): StoredScoreEvent[] {
    return this.matches.listScoreEvents()
  }
}
