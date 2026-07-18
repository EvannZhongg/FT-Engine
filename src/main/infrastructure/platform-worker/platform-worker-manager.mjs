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
  #ready = false
  #lastHello = null
  #startPromise = null
  #manualRetryPromise = null

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
    return this.#ensureStarted()
  }

  retry() {
    if (this.#manualRetryPromise) return this.#manualRetryPromise

    this.#stopping = false
    this.#clearRestartTimer()
    this.#restartCount = 0
    const pending = this.#retryNow().finally(() => {
      if (this.#manualRetryPromise === pending) this.#manualRetryPromise = null
    })
    this.#manualRetryPromise = pending
    return pending
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
    this.#ready = false
    this.#lastHello = null
    if (worker) await worker.stop(graceMs)
  }

  terminate() {
    this.#stopping = true
    this.#clearRestartTimer()
    const worker = this.#worker
    this.#worker = null
    this.#ready = false
    this.#lastHello = null
    worker?.terminate()
  }

  async #retryNow() {
    if (this.#ready) {
      try {
        if (this.#isSessionActive()) await this.#reconnectSession()
        return { status: 'already_ready' }
      } catch (error) {
        this.#log('error', `Platform Worker device retry failed: ${errorMessage(error)}`)
        throw error
      }
    }
    try {
      const hello = await this.#ensureStarted()
      return { status: 'ready', hello }
    } catch (error) {
      this.#log('error', `Platform Worker manual retry failed: ${errorMessage(error)}`)
      this.scheduleRestart()
      throw error
    }
  }

  #ensureStarted() {
    if (this.#ready) return Promise.resolve(this.#lastHello)
    if (this.#startPromise) return this.#startPromise
    const pending = this.#createAndStart().finally(() => {
      if (this.#startPromise === pending) this.#startPromise = null
    })
    this.#startPromise = pending
    return pending
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
      this.#ready = false
      this.#lastHello = null
      if (!this.#stopping) this.#onUnavailable()
      this.scheduleRestart()
    })

    try {
      await worker.start()
      const hello = await worker.request('system.hello')
      this.#log('info', `Platform Worker ready: ${JSON.stringify(hello)}`)
      if (this.#isSessionActive()) await this.#reconnectSession()
      this.#ready = true
      this.#lastHello = hello
      return hello
    } catch (error) {
      this.#ready = false
      this.#lastHello = null
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
