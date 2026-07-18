export interface AppSettings {
  language: 'zh' | 'en' | 'ja'
  reset_shortcut: string
  suppress_reset_confirm: boolean
  suppress_zero_confirm: boolean
  device_remarks: Record<string, string>
  obs_protect_main: boolean
  project_preferences: Record<string, Record<string, string | number | boolean | null>>
}

export type AppSettingKey = keyof AppSettings

const APP_SETTING_KEYS = new Set<AppSettingKey>([
  'language',
  'reset_shortcut',
  'suppress_reset_confirm',
  'suppress_zero_confirm',
  'device_remarks',
  'obs_protect_main',
  'project_preferences'
])

export function createDefaultAppSettings(): AppSettings {
  return {
    language: 'zh',
    reset_shortcut: 'Ctrl+G',
    suppress_reset_confirm: false,
    suppress_zero_confirm: false,
    device_remarks: {},
    obs_protect_main: false,
    project_preferences: {}
  }
}

export function isAppSettingKey(key: string): key is AppSettingKey {
  return APP_SETTING_KEYS.has(key as AppSettingKey)
}

export function normalizeAppSetting(
  key: AppSettingKey,
  value: unknown
): AppSettings[AppSettingKey] {
  if (key === 'language') {
    if (value !== 'zh' && value !== 'en' && value !== 'ja') {
      throw new Error('SETTINGS_VALUE_INVALID')
    }
    return value
  }
  if (key === 'reset_shortcut') {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 64 ||
      /[\p{Cc}\u007f]/u.test(value)
    ) {
      throw new Error('SETTINGS_VALUE_INVALID')
    }
    return value
  }
  if (
    key === 'suppress_reset_confirm' ||
    key === 'suppress_zero_confirm' ||
    key === 'obs_protect_main'
  ) {
    if (typeof value !== 'boolean') throw new Error('SETTINGS_VALUE_INVALID')
    return value
  }
  if (key === 'device_remarks') return normalizeDeviceRemarks(value)
  return normalizeProjectPreferences(value)
}

function normalizeDeviceRemarks(value: unknown): Record<string, string> {
  if (!isPlainRecord(value)) throw new Error('SETTINGS_VALUE_INVALID')
  const entries = Object.entries(value)
  if (entries.length > 1000) throw new Error('SETTINGS_VALUE_INVALID')
  const remarks: Record<string, string> = {}
  for (const [deviceId, remark] of entries) {
    if (!deviceId || deviceId.length > 128 || typeof remark !== 'string' || remark.length > 256) {
      throw new Error('SETTINGS_VALUE_INVALID')
    }
    remarks[deviceId] = remark
  }
  return remarks
}

function normalizeProjectPreferences(value: unknown): AppSettings['project_preferences'] {
  if (!isPlainRecord(value)) throw new Error('SETTINGS_VALUE_INVALID')
  const projects = Object.entries(value)
  if (projects.length > 1000) throw new Error('SETTINGS_VALUE_INVALID')
  const normalized: AppSettings['project_preferences'] = {}
  for (const [sourceKey, preferences] of projects) {
    if (!sourceKey || sourceKey.length > 256 || !isPlainRecord(preferences)) {
      throw new Error('SETTINGS_VALUE_INVALID')
    }
    const entries = Object.entries(preferences)
    if (entries.length > 64) throw new Error('SETTINGS_VALUE_INVALID')
    normalized[sourceKey] = {}
    for (const [preferenceKey, preferenceValue] of entries) {
      if (!preferenceKey || preferenceKey.length > 128 || !isSettingScalar(preferenceValue)) {
        throw new Error('SETTINGS_VALUE_INVALID')
      }
      normalized[sourceKey][preferenceKey] = preferenceValue
    }
  }
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 512 * 1024) {
    throw new Error('SETTINGS_VALUE_INVALID')
  }
  return normalized
}

function isSettingScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length <= 4096)
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
