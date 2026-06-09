# One bounded context per MCP server

The deployment unit is a small MCP server owned by one bounded context, such
as billing, CRM, source control, or internal documentation.

Tools, resources, prompts, authorization rules, and release ownership should
form one coherent domain boundary. Unrelated domains must not be collected in
a single super-server. Cross-domain integration uses an explicit API, event,
or application port rather than a shared database contract.
