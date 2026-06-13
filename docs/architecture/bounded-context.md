# Server Scope

An MCP server should usually belong to one product area or bounded context: billing, CRM, source control, internal docs, or another domain your team can name clearly.

Keep tools, prompts, resources, authorization rules, and release ownership together. If two areas have different owners, data models, or release pressure, make them separate servers and connect them through normal APIs or events.

This keeps a server small enough that users can understand what it can do before they connect it to a client.
