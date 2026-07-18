export type RefereeMode = 'SINGLE' | 'DUAL'
export type DeviceRole = 'primary' | 'secondary'

export interface CounterTotals {
  totalPlus: number
  totalMinus: number
}

export interface RefereeScore {
  total: number
  plus: number
  minus: number
  penalty: number
}

export interface DeviceCounterEvent extends CounterTotals {
  eventId: string
  role: DeviceRole
  eventType: number
  deviceTimestampMs: number
}

export interface RefereeScoringState {
  mode: RefereeMode
  primary: CounterTotals
  secondary: CounterTotals
  score: RefereeScore
  processedEventIds: readonly string[]
}

const MAX_RECENT_EVENT_IDS = 2048
const ZERO_COUNTERS: CounterTotals = { totalPlus: 0, totalMinus: 0 }
const ZERO_SCORE: RefereeScore = { total: 0, plus: 0, minus: 0, penalty: 0 }

export class ScoringDomainError extends Error {
  readonly code = 'INVALID_DEVICE_EVENT'
}

export function createRefereeScoringState(mode: RefereeMode): RefereeScoringState {
  if (mode !== 'SINGLE' && mode !== 'DUAL') {
    throw new ScoringDomainError('Unsupported referee mode')
  }
  return {
    mode,
    primary: { ...ZERO_COUNTERS },
    secondary: { ...ZERO_COUNTERS },
    score: { ...ZERO_SCORE },
    processedEventIds: []
  }
}

export function applyDeviceCounterEvent(
  state: RefereeScoringState,
  event: DeviceCounterEvent
): RefereeScoringState {
  validateEvent(event)
  if (state.processedEventIds.includes(event.eventId)) return state

  const counters = {
    totalPlus: event.totalPlus,
    totalMinus: event.totalMinus
  }
  const primary = event.role === 'primary' ? counters : state.primary
  const secondary = event.role === 'secondary' ? counters : state.secondary
  return {
    mode: state.mode,
    primary: { ...primary },
    secondary: { ...secondary },
    score: calculateScore(state.mode, primary, secondary),
    processedEventIds: [
      ...state.processedEventIds.slice(-(MAX_RECENT_EVENT_IDS - 1)),
      event.eventId
    ]
  }
}

export function resetRefereeScoringState(state: RefereeScoringState): RefereeScoringState {
  return {
    ...state,
    primary: { ...ZERO_COUNTERS },
    secondary: { ...ZERO_COUNTERS },
    score: { ...ZERO_SCORE }
  }
}

export function calculateScore(
  mode: RefereeMode,
  primary: CounterTotals,
  secondary: CounterTotals
): RefereeScore {
  if (mode === 'SINGLE') {
    return {
      total: primary.totalPlus - primary.totalMinus,
      plus: primary.totalPlus,
      minus: primary.totalMinus,
      penalty: 0
    }
  }
  return {
    total: primary.totalPlus - secondary.totalPlus,
    plus: primary.totalPlus,
    minus: secondary.totalPlus,
    penalty: primary.totalMinus + secondary.totalMinus
  }
}

function validateEvent(event: DeviceCounterEvent): void {
  if (
    typeof event.eventId !== 'string' ||
    event.eventId.length < 1 ||
    event.eventId.length > 128 ||
    (event.role !== 'primary' && event.role !== 'secondary') ||
    !Number.isSafeInteger(event.totalPlus) ||
    event.totalPlus < 0 ||
    !Number.isSafeInteger(event.totalMinus) ||
    event.totalMinus < 0 ||
    !Number.isSafeInteger(event.eventType) ||
    !Number.isSafeInteger(event.deviceTimestampMs) ||
    event.deviceTimestampMs < 0
  ) {
    throw new ScoringDomainError('Invalid device counter event')
  }
}
