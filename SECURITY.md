# Security Policy

Zack handles authentication sessions, password-gated links, and role-scoped
access to team resources. If you find a vulnerability, please report it
privately rather than opening a public issue.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** button under this repository's
[Security tab](../../security/advisories/new). That opens a private advisory
visible only to the maintainers, so the issue can be fixed before it is
disclosed.

Please do not open a public issue, pull request, or discussion for a suspected
vulnerability — a public report makes every deployed instance exploitable while
a fix is still pending.

Helpful details, when you have them:

- Zack version (see the footer of the dashboard, or `GET /api/version`)
- Whether the instance runs behind a reverse proxy, and the `TRUST_PROXY` value
- Steps to reproduce, and what an attacker gains
- Any relevant log output, with secrets redacted

## Supported versions

Security fixes land on the latest released version. Zack is versioned with
semantic-release; there are no separately maintained release branches, so
upgrading to the current release is the supported remediation path.

## Scope

In scope: the API, the redirect handler, the dashboard SPA, the authentication
and session layer, the domain-verification flow, and the shipped Docker/Compose
configuration.

Out of scope: vulnerabilities in an operator's own infrastructure (reverse
proxy, TLS termination, DNS, host hardening), which the deployment model
explicitly leaves to the operator — see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and
[`docs/deployment/reverse-proxy.md`](docs/deployment/reverse-proxy.md).

Two configuration notes that are frequently mistaken for vulnerabilities, and
are documented behaviour rather than bugs:

- `TRUST_PROXY=false` on an instance that *is* behind a proxy collapses every
  client into one rate-limit bucket. Setting it `true` without a proxy in front
  lets any client spoof `X-Forwarded-For`. Both directions are described in the
  [README](README.md#configuration).
- Redirect targets are operator- and user-supplied by design. Zack shortens
  arbitrary URLs; that is the product, not an open-redirect flaw.
