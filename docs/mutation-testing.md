# Testing

Run normal tests first:

```sh
npm test
npm run quality:fast
```

Use mutation testing after the normal suite is already useful. It is slower, but it finds tests that execute code without checking the behavior that matters.

```sh
npx mcp-kit quality --mutation
```

The default mutation break threshold is `80%`. Text and HTML reports are written by Stryker.

## When To Use Mutation Testing

Mutation testing is worth running on code that carries real behavior: validation, authorization, state changes, money, persisted data, public API output, and error handling.

It is usually not worth chasing every mutation in logs, generated code, tiny DTOs, or glue code that has no observable behavior.

## Configuration

Project-specific mutation settings belong in `quality.config.*`.

```ts
import { defineQualityConfig } from '@mcp-kit/cli'

export default defineQualityConfig({
  preset: 'standard',
  mutation: {
    enabled: true,
    exclude: [
      {
        pattern: 'src/generated/**',
        reason: 'generated code is checked by the generator tests'
      }
    ]
  }
})
```

Every exclusion needs a reason. Keep exclusions narrow enough that a future reader can tell why the behavior is not owned by the project.

For mature projects, raise the threshold only after the current report is understandable.

```ts
import { defineQualityConfig } from '@mcp-kit/cli'

export default defineQualityConfig({
  preset: 'standard',
  mutation: {
    enabled: true,
    runInRelease: true,
    threshold: 90
  }
})
```

The repository baseline is [stryker.config.json](../stryker.config.json).
