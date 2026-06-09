import { definePrompt } from '@mcp-kit/core'
import { z } from 'zod'

export const healthPrompt = definePrompt({
  name: 'health-summary',
  title: 'Health summary',
  description: 'Create a concise health summary.',
  argsSchema: z.object({
    audience: z.string().default('operator')
  }),
  render: ({ input }) => ({
    description: `Health summary for ${input.audience}.`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Summarize the server health for ${input.audience}.`
        }
      }
    ]
  })
})
