const feature = '^src/features/[^/]+'

module.exports = {
  forbidden: [
    {
      name: 'domain-must-not-depend-on-outer-layers',
      severity: 'error',
      from: { path: `${feature}/domain` },
      to: {
        path: `^src/(server|mcp)|${feature}/(application|mcp|infrastructure)`
      }
    },
    {
      name: 'policy-must-not-import-mcp-sdk',
      severity: 'error',
      from: { path: `${feature}/(domain|application)` },
      to: { path: '^@modelcontextprotocol/' }
    },
    {
      name: 'application-must-not-depend-on-outer-layers',
      severity: 'error',
      from: { path: `${feature}/application` },
      to: { path: `${feature}/(mcp|infrastructure)` }
    },
    {
      name: 'mcp-must-not-import-infrastructure',
      severity: 'error',
      from: { path: `${feature}/mcp` },
      to: { path: `${feature}/infrastructure` }
    },
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true }
    } /* {{STRICT_DEPENDENCY_RULES}} */
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'default']
    }
  }
}
