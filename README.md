# Guildcraft

**English** | [Português (BR)](README.pt-BR.md) | [Русский](README.ru.md)

A pixel-art guild workshop where every adventurer is a live Claude Code agent. 🏰

You recruit one adventurer per project folder, and each of them is a real `claude` process running in that folder. They sit at their stations, pace around the workshop, and change pose depending on what the agent is actually doing. Click one and you get its console. Ask one to talk to another and you can watch the message walk across the room.

> Work in progress. Not published yet.

![The guild workshop with its adventurers at their stations](docs/screenshots/workshop.png)

![Adventurers walking around the workshop](docs/screenshots/visit.gif)

## What it does

Running several Claude Code sessions in separate terminals gets messy fast. You lose track of which one is thinking, which one is stuck waiting for a permission, and which one finished ten minutes ago. Guildcraft puts all of them in one place and turns their state into something you can read at a glance.

- **One villager per project.** Pick a folder, give it a name and a look, and a Claude Code agent starts there.
- **Status you can see.** Working, idle, waiting for permission: the villager's pose and position tell you without opening anything.
- **A real console.** Click a villager to open its terminal. It is the actual Claude Code TUI, not a log viewer, and the screen is restored if you reload the page.
- **Permissions from the game UI.** When an agent asks to run something, a card shows up and you answer it there.
- **Agents talking to agents.** Each agent gets a small MCP server with `list_villagers` and `send_message`. When one sends a message, its villager walks over to the recipient, and the message is delivered once the recipient is idle.
- **Activity history.** Model, effort and a per-agent list of recent actions, read from Claude Code's own session files.

Everything runs on your machine. Nothing is sent anywhere except what Claude Code itself already sends.

### Look closer

| Agent panel                                                                       | Recruiting                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| ![Agent panel with status, model and recent commands](docs/screenshots/panel.png) | ![Recruit dialog with the character picker](docs/screenshots/recruit.png) |

## How it works

```
 browser (canvas + xterm)
        |  WebSocket
        v
 guildcraft server (Node) ---- spawns ----> claude (in a PTY, one per agent)
        ^                                        |
        | HTTP POST                              | hooks + MCP
        +------------ bin/hook.js, bin/mcp.js <--+
```

1. You create an agent in the UI. The server writes a per-agent `settings.json` and `mcp.json` that point Claude Code's hooks and MCP at guildcraft's small helper scripts.
2. The server spawns `claude` inside a PTY (node-pty) and mirrors its screen with a headless xterm, so the console can be restored later.
3. Claude Code fires hooks (tool use, stop, notification and so on). The hook script POSTs them back to the server, which turns them into a status and broadcasts it over WebSocket.
4. The browser receives the status and the villager changes pose. Transcript tailing fills in the details hooks cannot give: model, effort and the action history.
5. For agent-to-agent messages, the MCP `send_message` call hits the server, which broadcasts a visit (so the villager walks over) and queues the text until the recipient is idle, then pastes it into its PTY.

The front end is a plain Canvas 2D engine with no framework. Characters, stations and the map are all data in `assets/`, so changing the art or the layout does not touch the code. See [docs/ASSETS.md](docs/ASSETS.md).

### How agents find each other

Agents talk to each other by **name**, not by id. Claude Code itself knows nothing about the guildcraft registry. Everything below happens in the server.

1. Every agent has a unique name (the server refuses duplicates) and an internal UUID. The server keeps a registry that links the name, the UUID and the PTY running that agent's `claude`.
2. An agent calls the MCP tool `list_villagers` to see who else is around (name, folder, status, what they are doing), then `send_message` with `to: "<name>"`.
3. The MCP helper sends `POST /api/<sender-id>/messages`. The sender id comes from the agent's own `mcp.json`, which is how the server knows who is talking.
4. The server looks the recipient up by name (case-insensitive, surrounding spaces ignored), finds its PTY through the UUID, and queues the text until the recipient is idle. Then it types it into that console as `[Message from <sender>]`.
5. An unknown name, an offline recipient or a full queue comes back to the sender as a plain error message.

The name is not injected into the model's prompt: an agent learns its peers from `list_villagers` and who wrote to it from the `[Message from ...]` prefix.

## Safety

- The server binds to `127.0.0.1` only.
- Every session gets a random token, and the WebSocket checks both the token and the `Origin` header.
- Agents are spawned with `GUILDCRAFT_*` and parent Claude Code session variables stripped from their environment.

## Requirements

- Node.js 20+
- Claude Code installed and logged in

## Platform support

| Platform   | Status         |
| ---------- | -------------- |
| Windows 11 | Tested, works  |
| Linux      | Not tested yet |
| macOS      | Not tested yet |

CI builds and runs the test suite on all three, but the app itself has only been exercised by hand on Windows 11 so far.

## Usage

```sh
npx guildcraft
```

It opens the workshop in your browser. The default port is 7777, and you can change it with `GUILDCRAFT_PORT`.

Want to look around without a server or Claude? Open the web app with `?demo` and you get simulated agents.

## Development

```sh
npm install
npm run dev
```

| Script                  | What it does                               |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Server and web with live reload            |
| `npm run build`         | Build to `dist/`                           |
| `npm run lint`          | ESLint                                     |
| `npm run typecheck`     | TypeScript for server and web              |
| `npm test`              | Unit and integration tests                 |
| `npm run test:coverage` | Same tests with the 80% coverage threshold |

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code is [MIT](LICENSE). Art assets keep their own licenses, listed in `assets/CREDITS.md`.
