import readline from 'node:readline'


const protocolVersion = 1
const input = readline.createInterface({ input: process.stdin })

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

input.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.method === 'test.malformed') {
    process.stdout.write('not-json\n')
    return
  }
  if (request.method === 'test.event') {
    send({ protocolVersion, event: 'device.score', eventId: 'event-1', payload: { total: 3 } })
  }
  if (request.method === 'test.error') {
    send({
      protocolVersion,
      id: request.id,
      ok: false,
      error: { code: 'USB_PORT_BUSY', message: 'USB port is busy' }
    })
    return
  }

  const result = request.method === 'system.hello'
    ? { protocolVersion, platform: 'virtual', capabilities: {} }
    : request.method === 'system.shutdown'
      ? { stopping: true }
      : { echo: request.params.echo }
  send({ protocolVersion, id: request.id, ok: true, result })
  if (request.method === 'system.shutdown') {
    input.close()
    process.stdin.unref()
  }
})
