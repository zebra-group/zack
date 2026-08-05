# Contributing to Zack

Thanks for considering a contribution. Please read the testing expectation
below before you start — it is the one rule that most often causes a pull
request to be sent back.

## Tests are not optional

Zack is developed test-first. Every change to behaviour needs a test, and the
test is expected to be written *before* the implementation that makes it pass:

- **Any function you add or change** needs at least one unit test.
- **Any UI change** (component, view, user-facing flow) needs unit tests *and* a
  Playwright end-to-end test.
- Adapting an existing assertion to a new expected value is fine. Deleting,
  skipping, or loosening an assertion to make a suite go green is not — if a
  test cannot be satisfied, say so in the pull request instead of weakening it.

CI runs the whole suite on every change, so a pull request without tests will
not merge.

## Repository layout

This is a pnpm workspace monorepo:

| Path | Contents |
|---|---|
| `apps/api` | Fastify backend, Prisma schema, redirect handler |
| `apps/web` | Vue 3 dashboard (SPA) |
| `apps/e2e` | Playwright end-to-end suite |
| `packages/shared` | DTOs and types shared between api and web |

## Setup

Requires **Node.js 24.x** (see `engines.node` in `package.json`) and pnpm.

```bash
pnpm install
```

## Checks

```bash
pnpm typecheck
pnpm build
```

For the test suites, use the CI form:

```bash
pnpm run -r --filter='!@zack/e2e' test
```

Do **not** run a bare `pnpm test` at the repository root. It would also start
the Playwright suite against a Compose stack that is not running, and fail for
reasons unrelated to your change. That is why the command above excludes
`@zack/e2e`.

## End-to-end tests

The E2E suite runs against the built Docker image in production shape, not
against dev servers:

```bash
./scripts/e2e-compose.sh
```

It needs host ports **3000, 5433, 8025 and 9000** free — the app, the dedicated
E2E Postgres, the Mailpit SMTP catcher, and a mock OIDC provider. If any of
those are occupied by unrelated containers, the run will fail before reaching
your test.

Type-check E2E specs without booting the stack:

```bash
pnpm --filter @zack/e2e exec tsc --noEmit
```

## Commit messages

The project releases with semantic-release from `main`, so commit types
directly determine the next version number:

| Prefix | Effect |
|---|---|
| `fix:` | patch release |
| `feat:` | minor release |
| `BREAKING CHANGE:` in the body | major release |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:` | no release |

Use [Conventional Commits](https://www.conventionalcommits.org/). A scope is
welcome (`fix(redirect): …`). Do not edit `CHANGELOG.md` or the `version` field
in `package.json` by hand — semantic-release owns both.

## Pull requests

- One logical change per pull request; keep unrelated refactors separate.
- Make sure `pnpm typecheck`, `pnpm build`, and the test command above pass
  locally.
- Describe what you changed and how you tested it. If you could not run the E2E
  suite (for example because the required ports were busy), say so rather than
  implying it passed.

## Deployment and configuration

Operational documentation lives in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (infrastructure, build, deploy flow,
environment variables, troubleshooting, image releases) and
[`docs/deployment/reverse-proxy.md`](docs/deployment/reverse-proxy.md). The
environment surface is summarised in the [README](README.md#configuration).

## Dependency updates

Dependabot opens update pull requests weekly. Patch and minor bumps are merged
automatically once CI passes — `.github/workflows/dependabot-auto-merge.yml`
triggers on a successful CI run rather than on the pull request itself, so no
update lands without a green suite. Major bumps are deliberately left for a
human to review and merge.

## The main branch

`main` is protected against force-pushes and deletion, with no exceptions
configured — the rule applies to maintainers too. Releases are cut from it
automatically: semantic-release runs on every push to `main` once the test and
smoke jobs pass, and pushes the resulting `package.json` and `CHANGELOG.md`
changes back itself, which is why neither file should be edited by hand.

Secret scanning with push protection is enabled. A push containing a
recognisable credential is rejected by the server before it lands, so treat such
a rejection as a real finding rather than a glitch to work around.

## Security

Do not report vulnerabilities in a public issue or pull request. See
[`SECURITY.md`](SECURITY.md).
