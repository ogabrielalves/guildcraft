# Contributing

## Setup

```sh
npm install
npm run dev
```

## Rules

- TypeScript strict, ESM, named exports, `kebab-case.ts` files.
- No comments that narrate code. A one-line comment is fine for something non-obvious.
- UI text always goes through `t('key')`, in `en` and `pt-BR`.
- Every `feat` and `fix` ships with tests. Coverage must stay at or above 80%.

## Commits

[Conventional Commits](https://www.conventionalcommits.org), header up to 72 characters:

```
feat(agents): queue prompts until idle
fix(platform): resolve claude.cmd on windows
```

Scopes: `shared`, `server`, `agents`, `hooks`, `mcp`, `cli`, `platform`, `web`, `game`, `ui`,
`i18n`, `assets`, `deps`, `release`.

## Git hooks

| Hook         | Runs                                           |
| ------------ | ---------------------------------------------- |
| `pre-commit` | ESLint, Prettier and tests related to the diff |
| `commit-msg` | commitlint                                     |
| `pre-push`   | Typecheck, full suite with coverage and build  |

## Pull requests

Branch from `main` (`feat/...`, `fix/...`, `chore/...`), open a PR and squash merge. CI must be
green on Windows, Linux and macOS.

## Assets

Every asset must be listed in `assets/CREDITS.md` with author, link and license. Do not add art
whose license forbids redistribution.
