# Tutorial

This tutorial walks through the smallest supported `mcp-kit` workflow.

## 1. Create a server

```sh
corepack pnpm create mcp-kit my-server
cd my-server
```

For a non-interactive run:

```sh
corepack pnpm create mcp-kit my-server -- --yes --no-install
```

## 2. Inspect the generated shape

The generated project uses one official feature-first architecture:

- `src/features/<feature>/application`
- `src/features/<feature>/mcp`
- optional `domain`, `application/ports`, and `infrastructure` only when the
  feature needs them
- `src/mcp/registry.ts` as the explicit capability registry

## 3. Run quality checks

```sh
corepack pnpm quality:fast
```

Use the generated project-local command when working inside a created server:

```sh
npm run quality:fast
```

## 4. Add a tool

```sh
npx mcp-kit add tool get-user
```

This updates:

- the feature directory for `get-user`
- the explicit registry
- generated contract tests and docs where applicable

## 5. Run the server

For stdio projects:

```sh
npm run dev
```

For HTTP-enabled projects:

```sh
MCP_TRANSPORT=http npm run dev
```

## 6. Validate before release

```sh
corepack pnpm quality:fast
corepack pnpm quality:full
```

Release preparation always goes through the release gate:

```sh
npx mcp-kit release
```

## What to learn next

- [security-guide.md](./security-guide.md)
- [api-core.md](./api-core.md)
- [release.md](./release.md)
- [migration-guide.md](./migration-guide.md)
