# Security Policy

Guildcraft runs Claude Code agents that read, edit and execute files on your machine. The server
binds to `127.0.0.1`, and every WebSocket, hook and MCP request must carry a per-run session token.

## Reporting a vulnerability

Do not open a public issue. Use
[GitHub private vulnerability reporting](https://github.com/ogabrielalves/guildcraft/security/advisories/new).

Please include steps to reproduce and the affected version. You will get an answer within a week.

## Supported versions

Only the latest release receives fixes.
