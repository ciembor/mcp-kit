import { cp, readdir, rename } from 'node:fs/promises'
import { resolve } from 'node:path'

const [, , sourceArg, destinationArg] = process.argv

if (sourceArg === undefined || destinationArg === undefined) {
  throw new Error(
    'Usage: node scripts/prepare-bundled-template.mjs <source> <destination>'
  )
}

const source = resolve(sourceArg)
const destination = resolve(destinationArg)

await cp(source, destination, { recursive: true })
await hideBundledTemplateTests(resolve(destination, 'test'))

async function hideBundledTemplateTests(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }

  for (const entry of entries) {
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await hideBundledTemplateTests(absolute)
      continue
    }

    const renamed = bundledTemplateTestName(entry.name)
    if (renamed !== entry.name) {
      await rename(absolute, resolve(directory, renamed))
    }
  }
}

function bundledTemplateTestName(name) {
  if (name.endsWith('.test.ts')) {
    return name.replace(/\.test\.ts$/u, '.test.template.ts')
  }
  if (name.endsWith('.test.js')) {
    return name.replace(/\.test\.js$/u, '.test.template.js')
  }
  return name
}
