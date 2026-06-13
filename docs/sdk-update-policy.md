# SDK Updates

This page is for maintainers updating the MCP TypeScript SDK or protocol mapping.

Make SDK upgrades as their own change. Update [Compatibility](./compatibility.md) in the same pull request, and describe any user-visible behavior change in the changelog.

Protocol mapping changes need contract or conformance tests. If the mapping breaks documented behavior, treat it as a breaking release and add migration notes.

Experimental SDK features should stay behind explicit options until the project is ready to support them as public behavior.
