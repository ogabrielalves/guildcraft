# Guildcraft

A pixel-art guild workshop where every adventurer is a live Claude Code agent.

Recruit an adventurer per project, watch them work at their station, open their console with a
click and let them message each other.

> Work in progress. Not published yet.

## Requirements

- Node.js 20+
- Claude Code installed and logged in

## Usage

```sh
npx guildcraft
```

## Development

```sh
npm install
npm run dev
```

| Script              | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Server and web with live reload |
| `npm run build`     | Build to `dist/`                |
| `npm run lint`      | ESLint                          |
| `npm run typecheck` | TypeScript for server and web   |
| `npm test`          | Unit and integration tests      |

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code is [MIT](LICENSE). Art assets keep their own licenses, listed in `assets/CREDITS.md`.
