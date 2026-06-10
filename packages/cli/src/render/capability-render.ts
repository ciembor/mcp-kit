export function capabilityContent(
  kind: 'tool' | 'resource' | 'prompt',
  exported: string
): string {
  if (kind === 'resource') {
    return `import { defineResource } from '@mcp-kit/core'\n\nexport const ${exported} = defineResource({\n  name: '${exported.replace(/Resource$/, '')}',\n  uri: '${exported.replace(/Resource$/, '')}://value',\n  read: ({ uri }) => ({\n    contents: [{ uri: uri.toString(), text: 'TODO' }]\n  })\n})\n`
  }
  if (kind === 'prompt') {
    return `import { definePrompt } from '@mcp-kit/core'\nimport { z } from 'zod'\n\nexport const ${exported} = definePrompt({\n  name: '${exported.replace(/Prompt$/, '')}',\n  argsSchema: z.object({}),\n  render: () => ({\n    messages: [{ role: 'user', content: { type: 'text', text: 'TODO' } }]\n  })\n})\n`
  }
  return `import { defineTool } from '@mcp-kit/core'\nimport { z } from 'zod'\n\nexport const ${exported} = defineTool({\n  name: '${exported.replace(/Tool$/, '')}',\n  inputSchema: z.object({}),\n  outputSchema: z.object({ ok: z.boolean() }),\n  policy: { effects: 'read' },\n  handler: () => ({\n    structuredContent: { ok: true },\n    content: [{ type: 'text', text: 'ok' }]\n  })\n})\n`
}
