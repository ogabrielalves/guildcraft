# Security Policy

Guildcraft runs Claude Code agents that read, edit and execute files on your machine. The server
binds to `127.0.0.1`, and every WebSocket, hook and MCP request must carry a per-run session token.

The token reaches hooks and the MCP server through the `GUILDCRAFT_TOKEN` environment variable of
each agent, so it is never written to disk or shown in process arguments. Commands an agent runs
inherit that variable too. This is expected: agents already talk to the server through MCP.

## Reporting a vulnerability

Do not open a public issue. Use
[GitHub private vulnerability reporting](https://github.com/ogabrielalves/guildcraft/security/advisories/new).

Please include steps to reproduce and the affected version. You will get an answer within a week.

## Supported versions

Only the latest release receives fixes.
