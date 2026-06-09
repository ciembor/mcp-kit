import { exitCodes, type ParsedArgs } from './cli-contracts.js'
import { CliError } from './cli-error.js'

export function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const options: Record<string, string | boolean> = {}
  let command: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === undefined) continue
    if (command === undefined && !argument.startsWith('-')) {
      command = argument
      continue
    }
    if (argument.startsWith('--')) {
      const [key, inlineValue] = argument.slice(2).split('=', 2)
      if (key === undefined || key === '') continue
      if (inlineValue !== undefined) {
        options[key] = inlineValue
        continue
      }
      const next = args[index + 1]
      if (next !== undefined && !next.startsWith('-')) {
        options[key] = next
        index += 1
      } else {
        options[key] = true
      }
      continue
    }
    positionals.push(argument)
  }

  const parsed: ParsedArgs = { positionals, options }
  if (command !== undefined) parsed.command = command
  return parsed
}

export function getBoolean(parsed: ParsedArgs, name: string): boolean {
  return parsed.options[name] === true
}

export function getString(
  parsed: ParsedArgs,
  name: string
): string | undefined {
  const value = parsed.options[name]
  return typeof value === 'string' ? value : undefined
}

export function getEnum<const Value extends string>(
  parsed: ParsedArgs,
  name: string,
  values: readonly Value[]
): Value | undefined {
  const value = parsed.options[name]
  if (value === undefined || value === false) return undefined
  if (value === true || !values.includes(value as Value)) {
    throw new CliError(
      `Invalid --${name}. Expected one of: ${values.join(', ')}`,
      exitCodes.validation
    )
  }
  return value as Value
}
