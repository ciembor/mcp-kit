# Migration Guide

This guide defines how breaking changes will be introduced and documented in
`mcp-kit`.

## Current state

There are no released breaking migrations yet. When the first breaking release
lands, this document will gain a versioned section that maps old behavior to
the new contract.

## Required structure for each breaking release

Every breaking release must document:

1. who is affected
2. what changed in public API, generated files, or runtime behavior
3. how to migrate existing code
4. whether the change can be automated by `mcp-kit init`, `add`, or a codemod
5. what validation command should pass after migration

## Migration checklist

For each breaking change add a section like this:

```md
## 0.x -> 0.y

### Impact

- affected packages or commands
- generated template differences
- runtime behavior differences

### Required changes

1. update dependencies
2. apply code or config changes
3. regenerate managed files if needed

### Verification

- run `corepack pnpm quality:fast`
- run any transport-specific smoke or conformance checks if the change touches runtime behavior
```

## Non-goals

- This guide is not a changelog replacement.
- This guide should not explain internal refactors that do not affect callers.
- This guide should not normalize undocumented breaking changes; every breaking
  release must be listed here explicitly.
