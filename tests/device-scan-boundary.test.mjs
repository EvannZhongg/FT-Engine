import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeDeviceScanResult } from '../src/main/ipc/device-scan-dto.mts'

test('normalizes worker scan data to clone-safe DTOs', () => {
  const result = normalizeDeviceScanResult({
    devices: [
      {
        name: 'Counter A',
        address: 'ble-1',
        deviceId: 'ble-1',
        rssi: -42,
        remark: 'Judge A',
        transport: 'BLE',
        deviceObject: { circular: true }
      },
      { address: 'invalid-device', transport: 'UNKNOWN' }
    ],
    errors: [{ transport: 'BLE', code: 'BLE_POWERED_OFF', message: new Error('raw') }]
  })

  assert.deepEqual(result, {
    devices: [{
      name: 'Counter A',
      address: 'ble-1',
      deviceId: 'ble-1',
      rssi: -42,
      remark: 'Judge A',
      transport: 'BLE'
    }],
    errors: [{
      transport: 'BLE',
      code: 'BLE_POWERED_OFF',
      message: 'Device scan failed',
      retryable: true
    }]
  })
})

test('turns malformed or missing worker results into stable retryable errors', () => {
  assert.deepEqual(normalizeDeviceScanResult(null), {
    devices: [],
    errors: [{
      transport: 'WORKER',
      code: 'DEVICE_SCAN_INVALID_RESULT',
      message: 'Device scan failed',
      retryable: true
    }]
  })
  assert.equal(normalizeDeviceScanResult({ devices: [], errors: [] }).errors.length, 0)
  assert.equal(
    normalizeDeviceScanResult({ devices: [], errors: [null] }).errors[0].code,
    'DEVICE_SCAN_INVALID_RESULT'
  )
})
