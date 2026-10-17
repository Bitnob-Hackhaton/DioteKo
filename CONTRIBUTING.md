# Contributing

Thank you for contributing to DioteKo. Start with [QUICKSTART.md](QUICKSTART.md) to get the stack running. Agents and automated workflows follow [CLAUDE.md](CLAUDE.md).

## 1. Scope

- **Active:** `backend-nest/`, `frontmobile/`, `frontweb/`.

## 2. Branches and commits

- Branch names use a type prefix, as in the git history: `fix/<topic>`, `feat/<topic>`, `docs/<topic>`.
- Commit messages follow Conventional Commits: `type(scope): summary`. Examples from the history: `fix(backend/config): ...`, `docs: ...`, `chore(security): ...`.
- Release pull requests go from `develop` to `main`. Examples: see `docs/pr/`.

## 3. Before you open a pull request

| Changed | Run |
|---|---|
| `backend-nest/` | `npm run typecheck`, `npm test`. Add `npm run test:e2e` when you change routes or flows it covers (see [docs/TESTING.md](docs/TESTING.md)) |
| `frontmobile/` | `npm run lint` |
| `frontweb/` | `npm run lint`, `npm test` |
| Entities | `npm run migration:generate -- src/database/migrations/<Name>`, then review the generated SQL and run `npm run migration:run`. Never enable `synchronize` |

When you change a route, an env variable, a module or a command, update the matching canonical file in the same change: `docs/ARCHITECTURE_AS_BUILT.md`, `docs/DEV_WORKFLOW.md`, `docs/DATABASE_MODEL.md`. Update the root doc that describes it too.

## 4. Backend rules

- Validate every input with a DTO. The global `ValidationPipe` rejects unknown fields.
- Errors go through the global `HttpExceptionFilter`. Responses never contain stack traces. Use the right HTTP status.
- Log the lifecycle with `[START]`, `[ENTITY]`, `[CALL]`, `[RESULT]` and `[STATE]` tags. Log identifiers and state changes.
- Never log secrets, tokens, bank details or raw personal data.
- Keep secrets in gitignored env files. `.env.example` files contain blank values only.
- Webhooks are signals. Read the object from the provider before changing any money-related state (see [docs/ARCHITECTURE_AS_BUILT.md §5 and §6](docs/ARCHITECTURE_AS_BUILT.md)).

## 5. Frontend rules

- Every network call handles loading, error and success states.
- Do not copy server business rules into the client.
- `EXPO_PUBLIC_*` values are bundled into the app. Never put a secret in them.
- Keep code style consistent with the existing ESLint and Prettier setup (`npm run lint`; `npm run format` in `frontweb`).

## 6. Bugs and known issues

Check [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) before you report a bug. If you find a limitation you will not fix now, add it there.

When you open an issue, include: the steps, the expected and actual behaviour, the endpoint and HTTP status, your environment (OS, Node version, device, commit) and the relevant logs. Remove any token or secret from the logs first.

## 7. Documentation

Documentation lives in the root files and in `docs/`. Keep them in line with the code. The rule for updating the architecture document is in [docs/ARCHITECTURE_AS_BUILT.md §11](docs/ARCHITECTURE_AS_BUILT.md).
