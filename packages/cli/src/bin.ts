#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { runCli } from './index.js'

export async function main(args: readonly string[] = process.argv.slice(2)) {
  process.exitCode = await runCli(args)
}

/* v8 ignore next 5 -- exercised by Node when this file is the process entrypoint. */
if (process.argv[1] !== undefined) {
  if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    await main()
  }
}
