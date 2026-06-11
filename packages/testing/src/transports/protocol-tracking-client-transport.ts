import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export class ProtocolTrackingClientTransport implements Transport {
  onclose: NonNullable<Transport['onclose']> = () => {}
  onerror: NonNullable<Transport['onerror']> = () => {}
  onmessage: NonNullable<Transport['onmessage']> = () => {}
  protocolVersion: string | undefined

  constructor(private readonly transport: StdioClientTransport) {}

  async start(): Promise<void> {
    this.transport.onclose = () => this.onclose()
    this.transport.onerror = (error) => this.onerror(error)
    this.transport.onmessage = (message: JSONRPCMessage) => {
      if (
        'result' in message &&
        typeof message.result === 'object' &&
        message.result !== null &&
        'protocolVersion' in message.result &&
        typeof message.result['protocolVersion'] === 'string'
      ) {
        this.protocolVersion = message.result['protocolVersion']
      }
      this.onmessage(message)
    }
    await this.transport.start()
  }

  send(message: JSONRPCMessage): Promise<void> {
    return this.transport.send(message)
  }

  close(): Promise<void> {
    return this.transport.close()
  }
}
