import { exitCodes, type ParsedArgs } from './cli-contracts.js'
import { CliError } from './cli-error.js'

export function parseArgs(args: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { positionals: [], options: {} }
  for (let index = 0; index < args.length; index += 1) {
    index += consumeArgument(parsed, args, index)
  }
  return parsed
}

function consumeArgument(
  parsed: ParsedArgs,
  args: readonly string[],
  index: number
): number {
  const argument = args[index]
  if (argument === undefined) return 0
  if (parsed.command === undefined && !argument.startsWith('-')) {
    parsed.command = argument
    return 0
  }
  if (!argument.startsWith('--')) {
    parsed.positionals.push(argument)
    return 0
  }
  return consumeOption(parsed.options, argument.slice(2), args[index + 1])
}

function consumeOption(
  options: Record<string, string | boolean>,
  option: string,
  next: string | undefined
): number {
  const [key, inlineValue] = option.split('=', 2)
  if (key === undefined || key === '') return 0
  if (inlineValue !== undefined) {
    options[key] = inlineValue
    return 0
  }
  const consumesNext = next !== undefined && !next.startsWith('-')
  options[key] = consumesNext ? next : true
  return Number(consumesNext)
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
