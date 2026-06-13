import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/mcp-kit/',
  title: 'mcp-kit',
  description:
    'TypeScript and Node.js framework plus tooling for reliable MCP servers.',
  srcDir: '.',
  cleanUrls: true,
  themeConfig: {
    siteTitle: 'mcp-kit',
    nav: [
      { text: 'Start', link: '/index' },
      { text: 'Tutorial', link: '/tutorial' },
      { text: 'Deploy', link: '/http-deployment' },
      { text: 'Reference', link: '/reference/' }
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Overview', link: '/index' },
          { text: 'Tutorial', link: '/tutorial' },
          { text: 'Compatibility', link: '/compatibility' }
        ]
      },
      {
        text: 'Guides',
        items: [
          { text: 'HTTP Deployment', link: '/http-deployment' },
          { text: 'Security', link: '/security-guide' },
          { text: 'Testing', link: '/mutation-testing' },
          { text: 'Migration Notes', link: '/migration-guide' }
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
        text: 'Maintainers',
        items: [
          { text: 'Release', link: '/release' },
          { text: 'Semver', link: '/semver-policy' },
          { text: 'SDK Updates', link: '/sdk-update-policy' },
          {
            text: 'Server Scope',
            link: '/architecture/bounded-context'
          },
          {
            text: 'Package Notes',
            link: '/architecture/package-boundaries'
          },
          {
            text: 'Runtime Notes',
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
