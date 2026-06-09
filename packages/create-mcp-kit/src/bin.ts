#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { runCreateMcpKit } from './index.js'

export async function main(
  args: readonly string[] = process.argv.slice(2)
): Promise<void> {
  process.exitCode = await runCreateMcpKit(args)
}

/* v8 ignore next 5 -- exercised by Node when this file is the process entrypoint. */
if (process.argv[1] !== undefined) {
  if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    await main()
  }
}
