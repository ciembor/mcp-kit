import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export function trackProtocolVersion(
  transport: Transport,
  onProtocolVersion: (version: string) => void
): Transport {
  return new ProtocolTrackingTransport(transport, onProtocolVersion)
}

class ProtocolTrackingTransport implements Transport {
  onclose: NonNullable<Transport['onclose']> = () => {}
  onerror: NonNullable<Transport['onerror']> = () => {}
  onmessage: NonNullable<Transport['onmessage']> = () => {}

  constructor(
    private readonly transport: Transport,
    private readonly onProtocolVersion: (version: string) => void
  ) {}

  async start(): Promise<void> {
    this.transport.onclose = () => this.onclose()
    this.transport.onerror = (error) => this.onerror(error)
    this.transport.onmessage = (message, extra) => {
      if (
        'method' in message &&
        message.method === 'initialize' &&
        'params' in message &&
        typeof message.params === 'object' &&
        message.params !== null &&
        'protocolVersion' in message.params &&
        typeof message.params['protocolVersion'] === 'string'
      ) {
        this.onProtocolVersion(message.params['protocolVersion'])
      }
      this.onmessage(message, extra)
    }
    await this.transport.start()
  }

  send(...args: Parameters<Transport['send']>): ReturnType<Transport['send']> {
    return this.transport.send(...args)
  }

  close(): Promise<void> {
    return this.transport.close()
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version)
  }
}
