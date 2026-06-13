# Migration Notes

There are no released breaking migrations yet.

When a breaking release exists, this page will say who is affected, what changed, how to update existing code, and which command should pass after the change.

For now, use the changelog and the compatibility table:

| Need                                       | Where to look                         |
| ------------------------------------------ | ------------------------------------- |
| Version history                            | `CHANGELOG.md` in the repository root |
| Supported SDK, protocol, and Node versions | [Compatibility](./compatibility.md)   |
| Public API rules                           | [Semver](./semver-policy.md)          |

After upgrading, run:

```sh
npm run quality:fast
```
