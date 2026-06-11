# Mutation Testing

`mcp-kit quality --mutation` runs the full quality pipeline first and only then starts `stryker run`.

Default policy:

- mutation remains opt-in
- the default break threshold is `80%`
- text and HTML mutation reports are enabled by default

Recommended policy for mature projects:

- raise the break threshold to `90%`
- keep exclusions narrow and explain every exclusion next to the config entry

The repository-level baseline lives in [stryker.config.json](../stryker.config.json).
