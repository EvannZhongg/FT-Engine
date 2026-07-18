const DEFAULT_MAX_RESTARTS = 3

export class PlatformWorkerManager {
  #createClient
  #onEvent
  #onUnavailable
  #isSessionActive
  #reconnectSession
  #log
  #schedule
  #cancel
  #maxRestarts
  #worker = null
  #restartTimer = null
  #restartCount = 0
  #stopping = false

  constructor({
    createClient,
    onEvent,
    onUnavailable,
    isSessionActive,
    reconnectSession,
    log = () => {},
    schedule = setTimeout,
    cancel = clearTimeout,
    maxRestarts = DEFAULT_MAX_RESTARTS
  }) {
    this.#createClient = createClient
    this.#onEvent = onEvent
    this.#onUnavailable = onUnavailable
    this.#isSessionActive = isSessionActive
    this.#reconnectSession = reconnectSession
    this.#log = log
    this.#schedule = schedule
    this.#cancel = cancel
    this.#maxRestarts = maxRestarts
  }

  async start() {
    this.#stopping = false
    return this.#createAndStart()
  }

  request(method, params = {}, timeoutMs) {
    if (!this.#worker) throw new Error('WORKER_NOT_RUNNING')
    return this.#worker.request(method, params, timeoutMs)
  }

  async disconnectAll() {
    if (!this.#worker) return { skipped: true }
    return this.#worker.request('device.disconnectAll', {}, 5000)
  }

  scheduleRestart() {
    if (this.#stopping || this.#restartTimer || this.#restartCount >= this.#maxRestarts) return
    this.#restartCount += 1
    const delayMs = this.#restartCount * 1000
    this.#log(
      'warn',
      `Restarting Platform Worker in ${delayMs}ms ` + `(${this.#restartCount}/${this.#maxRestarts})`
    )
    this.#restartTimer = this.#schedule(async () => {
      this.#restartTimer = null
      try {
        await this.#createAndStart()
      } catch (error) {
        this.#log('error', `Platform Worker restart failed: ${errorMessage(error)}`)
        this.scheduleRestart()
      }
    }, delayMs)
  }

  async stop(graceMs = 750) {
    this.#stopping = true
    this.#clearRestartTimer()
    const worker = this.#worker
    this.#worker = null
    if (worker) await worker.stop(graceMs)
  }

  terminate() {
    this.#stopping = true
    this.#clearRestartTimer()
    const worker = this.#worker
    this.#worker = null
    worker?.terminate()
  }

  async #createAndStart() {
    const worker = this.#createClient()
    this.#worker = worker
    worker.on('stderr', (chunk) => {
      const message = chunk.trim()
      if (message) this.#log('warn', `[Platform Worker] ${message}`)
    })
    worker.on('protocolError', (error) => {
      this.#log('error', `Platform Worker protocol error: ${error.code}`)
    })
    worker.on('event', (message) => this.#onEvent(message))
    worker.on('exit', ({ code, signal }) => {
      this.#log('warn', `Platform Worker exited (code=${code}, signal=${signal})`)
      if (this.#worker !== worker) return
      this.#worker = null
      if (!this.#stopping) this.#onUnavailable()
      this.scheduleRestart()
    })

    try {
      await worker.start()
      const hello = await worker.request('system.hello')
      this.#log('info', `Platform Worker ready: ${JSON.stringify(hello)}`)
      if (this.#isSessionActive()) await this.#reconnectSession()
      return hello
    } catch (error) {
      worker.terminate()
      if (this.#worker === worker) this.#worker = null
      throw error
    }
  }

  #clearRestartTimer() {
    if (!this.#restartTimer) return
    this.#cancel(this.#restartTimer)
    this.#restartTimer = null
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
