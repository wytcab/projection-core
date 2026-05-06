# Contributing

Contributions are welcome. Before opening a PR, read this once.

## Hard rules

These will not change. PRs that violate them will be closed without review.

1. **No telemetry.** This project does not phone home. No anonymous usage stats, no install pings, no Sentry, no PostHog, no opt-in or opt-out telemetry of any kind.
2. **MIT only.** All contributions are licensed under MIT (the same license as this project). By opening a PR, you confirm you have the right to license your contribution under MIT.
3. **No `eval` or arbitrary remote code execution from user input.** Lenses run on user-trusted corpora; do not introduce paths that turn corpus content into executable code.

## How to contribute

1. Open an issue first for any non-trivial change. Avoids wasted work on PRs we will not accept.
2. Fork, branch from `main`, make your change, push, open a PR.
3. CI (when it exists) runs typecheck and build. Both must pass.
4. Squash-merge is the default; keep your branch's history clean.

## Local setup

```bash
git clone https://github.com/wytcab/<repo>.git
cd <repo>
pnpm install
pnpm typecheck
pnpm build
```

## Code style

- TypeScript strict mode.
- ESM (`"type": "module"`).
- Imports use `.js` extensions for relative paths (NodeNext module resolution).
- Prefer named exports over default exports.
- No `any`. Use `unknown` and narrow.

## Issue templates

See `.github/ISSUE_TEMPLATE/` for bug reports and feature requests.

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Be civil; assume good faith.
