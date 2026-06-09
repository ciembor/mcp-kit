module.exports = {
  forbidden: [
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'core-does-not-depend-on-adapters',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(node|testing|cli|create-mcp-kit)/' }
    },
    {
      name: 'runtime-does-not-depend-on-cli',
      severity: 'error',
      from: { path: '^packages/(core|node)/' },
      to: { path: '^packages/(cli|create-mcp-kit)/' }
    }
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
