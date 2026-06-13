# THIS PROJECT IS UNDER DEVELOPMENT, DO NOT USE YET

<div align="center">
  <img src="mcp-kit-banner.webp" alt="The missing TypeScript/JavaScript framework for reliable MCP servers." />
  <h1 align="center">MCP-KIT</h1>

  <p align="center">
    The missing TypeScript/JavaScript framework and tooling for reliable production MCP
servers.
  </p>

  <p align="center">
    <a href="#requirements">Requirements</a>
    ·
    <a href="#development">Development</a>
    ·
    <a href="#documentation">Documentation</a>
    ·
    <a href="#release">Release</a>
    ·
    <a href="#mutation-testing">Mutation Testing</a>
  </p>
</div>

# THIS PROJECT IS UNDER DEVELOPMENT, DO NOT USE YET

## Requirements

- Node.js 22.13+ or Node.js 24.x
- pnpm 11.5.2

The repository pins Node with `.nvmrc` and `.node-version`. If your shell does
not auto-switch runtimes, use `./scripts/pnpmw` to run `pnpm` on the pinned
Node version directly.

## Development

```sh
corepack enable
./scripts/pnpmw install --frozen-lockfile
./scripts/pnpmw quality
```

## Documentation Site

```sh
./scripts/pnpmw docs:dev
./scripts/pnpmw docs:build
./scripts/pnpmw docs:preview
```

## Documentation

- VitePress site source: [docs/](./docs/)
- Current project status: [docs/status.md](./docs/status.md)
- Core API reference: [docs/api-core.md](./docs/api-core.md)
- Compatibility matrix: [docs/compatibility.md](./docs/compatibility.md)
- Tutorial: [docs/tutorial.md](./docs/tutorial.md)
- Security guide: [docs/security-guide.md](./docs/security-guide.md)
- Semver policy: [docs/semver-policy.md](./docs/semver-policy.md)
- Migration guide: [docs/migration-guide.md](./docs/migration-guide.md)

## Release

The standard release and rollback procedure lives in [docs/release.md](./docs/release.md).

## Mutation Testing

Mutation testing guidance lives in [docs/mutation-testing.md](./docs/mutation-testing.md).
