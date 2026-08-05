# What this changes

<!-- What behaviour changes, and why. Link an issue if there is one. -->

## How it was tested

<!--
Be specific. If you could not run something, say so — an honest "the E2E suite
did not run because ports 3000/5433 were occupied" is far more useful than
silence that reads as a pass.
-->

## Checklist

- [ ] Tests were written **before** the implementation (see `CONTRIBUTING.md` —
      this project is test-first)
- [ ] Every added or changed function has at least one unit test
- [ ] UI changes additionally have a Playwright end-to-end test
- [ ] No existing assertion was deleted, skipped, or loosened to get a green run
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `pnpm run -r --filter='!@zack/e2e' test` passes
- [ ] Commit messages follow Conventional Commits (they drive the release
      version — see `CONTRIBUTING.md`)
- [ ] `CHANGELOG.md` and `package.json`'s `version` were **not** edited by hand
      (semantic-release owns both)
- [ ] Documentation updated if configuration, deployment, or environment
      variables changed
