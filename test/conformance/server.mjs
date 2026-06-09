import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

import {
  createMcpApp,
  definePrompt,
  defineRegistry,
  defineResource,
  defineTool
} from '../../packages/core/dist/index.js'

const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII='

const tools = defineRegistry([
  defineTool({
    name: 'test_audio_content',
    description: 'Return audio content.',
    inputSchema: z.object({}),
    handler: () => ({
      content: [{ type: 'audio', data: 'YXVkaW8=', mimeType: 'audio/wav' }]
    })
  }),
  defineTool({
    name: 'test_embedded_resource',
    description: 'Return an embedded resource.',
    inputSchema: z.object({}),
    handler: () => ({
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'test://embedded-resource',
            mimeType: 'text/plain',
            text: 'Embedded resource content for testing.'
          }
        }
      ]
    })
  }),
  defineTool({
    name: 'test_error_handling',
    description: 'Return a tool execution error.',
    inputSchema: z.object({}),
    handler: () => ({
      content: [{ type: 'text', text: 'Intentional test error.' }],
      isError: true
    })
  }),
  defineTool({
    name: 'test_image_content',
    description: 'Return image content.',
    inputSchema: z.object({}),
    handler: () => ({
      content: [{ type: 'image', data: image, mimeType: 'image/png' }]
    })
  }),
  defineTool({
    name: 'test_multiple_content_types',
    description: 'Return mixed content.',
    inputSchema: z.object({}),
    handler: () => ({
      content: [
        { type: 'text', text: 'Multiple content types test:' },
        { type: 'image', data: image, mimeType: 'image/png' },
        {
          type: 'resource',
          resource: {
            uri: 'test://mixed-content-resource',
            mimeType: 'application/json',
            text: '{"test":"data","value":123}'
          }
        }
      ]
    })
  }),
  defineTool({
    name: 'test_simple_text',
    description: 'Return simple text.',
    inputSchema: z.object({}),
    handler: () => ({
      content: [
        {
          type: 'text',
          text: 'This is a simple text response for testing.'
        }
      ]
    })
  }),
  defineTool({
    name: 'test_tool_with_progress',
    description: 'Report progress before returning.',
    inputSchema: z.object({}),
    handler: async ({ context }) => {
      await context.progress?.report({ progress: 0, total: 100 })
      await new Promise((resolve) => setTimeout(resolve, 50))
      await context.progress?.report({ progress: 50, total: 100 })
      await new Promise((resolve) => setTimeout(resolve, 50))
      await context.progress?.report({ progress: 100, total: 100 })
      return { content: [{ type: 'text', text: 'Progress complete.' }] }
    }
  })
])

const resources = defineRegistry([
  defineResource({
    name: 'static-binary',
    uri: 'test://static-binary',
    description: 'Static binary resource.',
    mimeType: 'image/png',
    read: ({ uri }) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'image/png',
          blob: image
        }
      ]
    })
  }),
  defineResource({
    name: 'static-text',
    uri: 'test://static-text',
    description: 'Static text resource.',
    mimeType: 'text/plain',
    subscriptions: true,
    read: ({ uri }) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/plain',
          text: 'This is the content of the static text resource.'
        }
      ]
    })
  }),
  defineResource({
    name: 'template-data',
    uriTemplate: 'test://template/{id}/data',
    description: 'Template test resource.',
    mimeType: 'application/json',
    read: ({ uri, params }) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'application/json',
          text: JSON.stringify({
            id: params.id,
            templateTest: true,
            data: `Data for ID: ${params.id}`
          })
        }
      ]
    })
  })
])

const prompts = defineRegistry([
  definePrompt({
    name: 'test_prompt_with_arguments',
    description: 'Prompt with arguments.',
    argsSchema: z.object({
      arg1: z.string().describe('First test argument'),
      arg2: z.string().describe('Second test argument')
    }),
    render: ({ input }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Prompt with arguments: arg1='${input.arg1}', arg2='${input.arg2}'`
          }
        }
      ]
    })
  }),
  definePrompt({
    name: 'test_prompt_with_embedded_resource',
    description: 'Prompt with an embedded resource.',
    argsSchema: z.object({ resourceUri: z.string() }),
    render: ({ input }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'resource',
            resource: {
              uri: input.resourceUri,
              mimeType: 'text/plain',
              text: 'Embedded resource content for testing.'
            }
          }
        }
      ]
    })
  }),
  definePrompt({
    name: 'test_prompt_with_image',
    description: 'Prompt with image content.',
    argsSchema: z.object({}),
    render: () => ({
      messages: [
        {
          role: 'user',
          content: { type: 'image', data: image, mimeType: 'image/png' }
        }
      ]
    })
  }),
  definePrompt({
    name: 'test_simple_prompt',
    description: 'Simple test prompt.',
    argsSchema: z.object({}),
    render: () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'This is a simple prompt for testing.'
          }
        }
      ]
    })
  })
])

const app = createMcpApp({
  name: 'mcp-kit-conformance',
  version: '0.0.0',
  services: {}
})
if (process.env.MCP_KIT_CONFORMANCE_DEBUG === '1') {
  app.sdk.server.onerror = (error) => process.stderr.write(`${error.stack}\n`)
}
app.tools(tools)
app.resources(resources)
app.prompts(prompts)

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: randomUUID
})
await app.connect(transport)

const server = createServer(async (request, response) => {
  if (process.env.MCP_KIT_CONFORMANCE_DEBUG === '1') {
    process.stderr.write(
      `${request.method} ${request.url} ${JSON.stringify(request.headers)}\n`
    )
    response.once('finish', () => {
      process.stderr.write(
        `${response.statusCode} ${JSON.stringify(response.getHeaders())}\n`
      )
    })
  }
  if (request.url !== '/mcp') {
    response.writeHead(404).end()
    return
  }
  try {
    const body =
      request.method === 'POST' ? await readJsonBody(request) : undefined
    if (process.env.MCP_KIT_CONFORMANCE_DEBUG === '1') {
      process.stderr.write(`${JSON.stringify(body)}\n`)
    }
    if (body?.method === 'notifications/initialized') {
      response.writeHead(202).end()
      return
    }
    await transport.handleRequest(request, response, body)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`)
    if (!response.headersSent) response.writeHead(500)
    response.end()
  }
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address === null || typeof address === 'string') process.exit(1)
  process.stdout.write(`http://127.0.0.1:${address.port}/mcp\n`)
})

const close = async () => {
  await app.close()
  server.close(() => process.exit())
}
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
