# SDK and protocol update policy

1. The official MCP specification and SDK types are the source of truth.
2. SDK upgrades are made in a dedicated change with release notes reviewed.
3. CI must pass on the lowest and highest supported Node.js lines.
4. The compatibility matrix is updated in the same change as the SDK.
5. Protocol mapping changes require contract and conformance tests.
6. A breaking protocol mapping requires a major mcp-kit release.
7. Experimental features remain behind explicit feature flags.
