import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'mcp-kit',
  description:
    'TypeScript and Node.js framework plus tooling for reliable MCP servers.',
  srcDir: '.',
  cleanUrls: true,
  themeConfig: {
    siteTitle: 'mcp-kit',
    nav: [
      { text: 'Guide', link: '/index' },
      { text: 'Tutorial', link: '/tutorial' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Architecture', link: '/architecture/runtime-ecosystem' }
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Overview', link: '/index' },
          { text: 'Tutorial', link: '/tutorial' },
          { text: 'Compatibility', link: '/compatibility' },
          { text: 'Migration Guide', link: '/migration-guide' }
        ]
      },
      {
        text: 'Guides',
        items: [
          { text: 'Security Guide', link: '/security-guide' },
          { text: 'HTTP Deployment', link: '/http-deployment' },
          { text: 'Release', link: '/release' },
          { text: 'Mutation Testing', link: '/mutation-testing' },
          { text: 'SDK Update Policy', link: '/sdk-update-policy' },
          { text: 'Semver Policy', link: '/semver-policy' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Reference Home', link: '/reference/' },
          { text: '@mcp-kit/core', link: '/reference/core' },
          { text: '@mcp-kit/node', link: '/reference/node' },
          { text: '@mcp-kit/node/fastify', link: '/reference/node-fastify' },
          { text: '@mcp-kit/cli', link: '/reference/cli' },
          { text: '@mcp-kit/testing', link: '/reference/testing' },
          { text: 'create-mcp-kit', link: '/reference/create-mcp-kit' }
        ]
      },
      {
        text: 'Architecture',
        items: [
          {
            text: 'Bounded Context',
            link: '/architecture/bounded-context'
          },
          {
            text: 'Package Boundaries',
            link: '/architecture/package-boundaries'
          },
          {
            text: 'Runtime Ecosystem',
            link: '/architecture/runtime-ecosystem'
          },
          {
            text: 'ADR 0001',
            link: '/adr/0001-stateless-first-streamable-http'
          }
        ]
      }
    ],
    search: {
      provider: 'local'
    },
    footer: {
      message: 'mcp-kit documentation',
      copyright: 'Built with VitePress'
    }
  }
})
