export class McpKitError extends Error {
  readonly code: string
  readonly safeMessage: string
  override readonly cause?: unknown

  constructor(args: {
    code: string
    message: string
    safeMessage?: string
    cause?: unknown
  }) {
    super(args.message, { cause: args.cause })
    this.name = 'McpKitError'
    this.code = args.code
    this.safeMessage = args.safeMessage ?? 'Operation failed.'
    this.cause = args.cause
  }
}
