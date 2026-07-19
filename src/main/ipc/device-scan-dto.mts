export interface DeviceScanErrorDto {
  transport: 'BLE' | 'USB' | 'WORKER'
  code: string
  message: string
  retryable: boolean
}

export interface DeviceScanResultDto {
  devices: Array<{
    name: string
    address: string
    deviceId: string
    rssi: number
    remark: string
    transport: 'BLE' | 'USB'
  }>
  errors: DeviceScanErrorDto[]
}

export function normalizeDeviceScanResult(value: unknown): DeviceScanResultDto {
  if (!isRecord(value)) return createDeviceScanFailure('DEVICE_SCAN_INVALID_RESULT')

  const rawDevices = Array.isArray(value.devices) ? value.devices : []
  const devices = rawDevices.flatMap((item) => normalizeDevice(item))
  const rawErrors = Array.isArray(value.errors) ? value.errors : []
  const errors = rawErrors.map((item) => normalizeDeviceScanError(item))
  const invalidErrorCount = errors.filter((error) => error === null).length
  const normalizedErrors = errors.filter(
    (error): error is DeviceScanErrorDto => error !== null
  )
  if (invalidErrorCount > 0) {
    normalizedErrors.push(createDeviceScanError('WORKER', 'DEVICE_SCAN_INVALID_RESULT'))
  }
  if (!Array.isArray(value.devices) || !Array.isArray(value.errors)) {
    normalizedErrors.push(createDeviceScanError('WORKER', 'DEVICE_SCAN_INVALID_RESULT'))
  }
  return { devices, errors: normalizedErrors }
}

export function createDeviceScanFailure(code: string): DeviceScanResultDto {
  return { devices: [], errors: [createDeviceScanError('WORKER', code)] }
}

function normalizeDevice(value: unknown): DeviceScanResultDto['devices'][number][] {
  if (!isRecord(value)) return []
  const transport = value.transport === 'USB' ? 'USB' : value.transport === 'BLE' ? 'BLE' : null
  const address = typeof value.address === 'string' ? value.address : ''
  const deviceId = typeof value.deviceId === 'string' ? value.deviceId : address
  if (!transport || !address || !deviceId) return []
  return [{
    name: typeof value.name === 'string' && value.name ? value.name : 'Unknown device',
    address,
    deviceId,
    rssi: typeof value.rssi === 'number' && Number.isFinite(value.rssi) ? value.rssi : -1000,
    remark: typeof value.remark === 'string' ? value.remark : '',
    transport
  }]
}

function normalizeDeviceScanError(value: unknown): DeviceScanErrorDto | null {
  if (!isRecord(value)) return null
  const transport = value.transport === 'USB' || value.transport === 'BLE' || value.transport === 'WORKER'
    ? value.transport
    : 'WORKER'
  const code = normalizeCode(value.code)
  return createDeviceScanError(transport, code)
}

function createDeviceScanError(
  transport: DeviceScanErrorDto['transport'],
  code: string
): DeviceScanErrorDto {
  return {
    transport,
    code: normalizeCode(code),
    message: 'Device scan failed',
    retryable: true
  }
}

function normalizeCode(value: unknown): string {
  if (typeof value !== 'string') return 'DEVICE_SCAN_FAILED'
  const code = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64)
  return code || 'DEVICE_SCAN_FAILED'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
