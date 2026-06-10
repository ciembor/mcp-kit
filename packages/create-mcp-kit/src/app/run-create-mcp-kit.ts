import { createMcpKitProject } from '../scaffold/create-project.js'
import { errorMessage } from '../shared/error-message.js'

export async function runCreateMcpKit(
  args: readonly string[] = process.argv.slice(2)
): Promise<number> {
  const projectPath = args.find((argument) => argument !== '--')
  if (projectPath === undefined) {
    process.stderr.write(
      'Usage: npm create mcp-kit@latest <project-directory>\n'
    )
    return 1
  }

  try {
    const target = await createMcpKitProject(projectPath)
    process.stderr.write(`Created MCP server in ${target}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`create-mcp-kit: ${errorMessage(error)}\n`)
    return 1
  }
}
