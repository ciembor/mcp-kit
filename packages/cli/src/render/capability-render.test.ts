import { describe, expect, it } from 'vitest'

import { capabilityContent } from './capability-render.js'

describe('capability render', () => {
  it('renders tool, resource and prompt templates', () => {
    expect(capabilityContent('tool', 'getUserTool')).toContain('defineTool')
    expect(
      capabilityContent('tool', 'syncReportTool', { async: true })
    ).toContain('createAsyncJobOperation')
    expect(capabilityContent('resource', 'profileResource')).toContain(
      'defineResource'
    )
    expect(capabilityContent('prompt', 'reviewPrompt')).toContain(
      'definePrompt'
    )
  })
})
