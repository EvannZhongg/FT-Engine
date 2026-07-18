import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'


export const WORKER_PROTOCOL_VERSION = 1
const MAX_MESSAGE_BYTES = 1024 * 1024


export class WorkerClientError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WorkerClientError'
    this.code = code
  }
}


export class WorkerClient extends EventEmitter {
  constructor({ command, args = [], cwd, env, requestTimeoutMs = 5000, spawnProcess = spawn }) {
    super()
    this.command = command
    this.args = args
    this.cwd = cwd
    this.env = env
    this.requestTimeoutMs = requestTimeoutMs
    this.spawnProcess = spawnProcess
    this.process = null
    this.stdoutBuffer = ''
    this.pending = new Map()
  }

  async start() {
    if (this.process) return
    const child = this.spawnProcess(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.process = child
    this.stdoutBuffer = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this._handleStdout(chunk))
    child.stderr.on('data', (chunk) => this.emit('stderr', chunk))
    child.once('exit', (code, signal) => this._handleExit(child, code, signal))

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        child.removeListener('spawn', onSpawn)
        reject(error)
      }
      const onSpawn = () => {
        child.removeListener('error', onError)
        child.on('error', (error) => this.emit('processError', error))
        resolve()
      }
      child.once('error', onError)
      child.once('spawn', onSpawn)
    })
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    const child = this.process
    if (!child || !child.stdin || child.stdin.destroyed) {
      return Promise.reject(new WorkerClientError('WORKER_NOT_RUNNING', 'Local worker is not running'))
    }
    if (typeof method !== 'string' || !method || !params || typeof params !== 'object' || Array.isArray(params)) {
      return Promise.reject(new WorkerClientError('INVALID_REQUEST', 'Invalid local worker request'))
    }

    const id = randomUUID()
    const message = JSON.stringify({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      id,
      method,
      params
    }) + '\n'

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new WorkerClientError('WORKER_TIMEOUT', `Local worker timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(message, 'utf8', (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(new WorkerClientError('WORKER_WRITE_FAILED', error.message))
      })
    })
  }

  async stop(timeoutMs = 1000) {
    const child = this.process
    if (!child) return
    try {
      await this.request('system.shutdown', {}, timeoutMs)
    } catch {
      this.terminate()
      return
    }
    if (this.process !== child) return

    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ])
    if (this.process === child) this.terminate()
  }

  terminate() {
    if (this.process) this.process.kill()
  }

  _handleStdout(chunk) {
    this.stdoutBuffer += chunk
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > MAX_MESSAGE_BYTES && !this.stdoutBuffer.includes('\n')) {
      this._failProtocol('WORKER_MESSAGE_TOO_LARGE', 'Local worker message exceeds the size limit')
      return
    }

    let newlineIndex = this.stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex)
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      if (line.trim()) this._handleLine(line)
      newlineIndex = this.stdoutBuffer.indexOf('\n')
    }
  }

  _handleLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      this._failProtocol('WORKER_INVALID_JSON', 'Local worker returned invalid JSON')
      return
    }
    if (!message || typeof message !== 'object' || message.protocolVersion !== WORKER_PROTOCOL_VERSION) {
      this._failProtocol('WORKER_PROTOCOL_MISMATCH', 'Local worker protocol version mismatch')
      return
    }
    if (typeof message.event === 'string') {
      this.emit('event', message)
      return
    }

    const pending = typeof message.id === 'string' ? this.pending.get(message.id) : null
    if (!pending) {
      this.emit('orphanResponse', message)
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.ok === true) {
      pending.resolve(message.result)
      return
    }
    const code = message.error?.code
    const text = message.error?.message
    pending.reject(new WorkerClientError(
      typeof code === 'string' ? code : 'WORKER_COMMAND_FAILED',
      typeof text === 'string' ? text : 'Local worker command failed'
    ))
  }

  _failProtocol(code, message) {
    const error = new WorkerClientError(code, message)
    this.emit('protocolError', error)
    this._rejectPending(error)
    this.terminate()
  }

  _handleExit(child, code, signal) {
    if (this.process !== child) return
    this.process = null
    const error = new WorkerClientError('WORKER_EXITED', 'Local worker exited')
    this._rejectPending(error)
    this.emit('exit', { code, signal })
  }

  _rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
