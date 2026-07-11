# Reverse Proxy & TLS

Kurzly's `docker-compose.yml` intentionally exposes **only the app port**
(`3000`, mapped as `3000:3000`) on the host. Postgres (`db`) is reachable
from `app` over the internal compose network only and is never published to
the host.

**TLS termination and the reverse proxy in front of that app port are the
operator's own responsibility.** Kurzly does not bundle or hard-wire any
particular proxy (D-03) — instead, this document gives copy-pasteable
configs for the common choices (D-04). Pick whichever fits your existing
infrastructure; all three examples below terminate TLS and forward plain
HTTP to `app:3000`.

> **Multi-domain note:** Kurzly resolves short links by the incoming `Host`
> header (custom domains per link, see the project's later multi-domain
> phase). Whichever proxy you choose must forward the original `Host`
> header unmodified to the `app` service — every example below already
> does this (`proxy_set_header Host $host;` for nginx, Caddy's default
> reverse_proxy behavior, and Traefik's router-per-Host-rule model). If you
> host multiple short-link domains, add one router/server-block/vhost per
> domain, all pointing at the same `app:3000` upstream.

## Prerequisites (all examples)

- DNS for every domain you intend to serve (dashboard domain and/or any
  custom short-link domains) already points at the host running the proxy.
- The Kurzly stack is running via `docker compose up -d` with only the
  `app` port bound to the host (the default in `docker-compose.yml` — do
  not additionally publish `db`'s port).
- Ports `80` and `443` on the host are free for the proxy to bind (needed
  for both the HTTP-01 ACME challenge and serving HTTPS).

---

## Option 1: Caddy (automatic HTTPS)

Caddy is the lowest-effort option: point it at your domain(s) and it
automatically obtains and renews Let's Encrypt certificates via the
ACME HTTP-01 challenge — no separate certbot step required.

`Caddyfile`:

```caddyfile
kurzly.example.com {
    reverse_proxy app:3000
}

# One block per additional custom short-link domain, if you host more
# than the dashboard's own domain:
# short.example.com {
#     reverse_proxy app:3000
# }
```

Run Caddy on the same Docker network as the `app` service (e.g. by adding
a `caddy` service to your compose file, or via an external network Caddy
joins), and mount the `Caddyfile` in:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - default

volumes:
  caddy-data:
  caddy-config:
```

Caddy stores certificates in the `caddy-data` volume — treat it like the
`db-data` volume: never remove it as part of a routine restart, or you'll
force a fresh ACME issuance (and risk Let's Encrypt rate limits) on every
redeploy.

### On-Demand TLS Integration (Caddy `ask` → `/api/tls-check`)

**Kurzly does not issue or terminate TLS certificates itself (D-01).** It
never runs an in-app ACME client and never handles private keys — TLS
issuance and termination are entirely the operator's own reverse proxy's
responsibility. What Kurzly *does* provide is a read-only, session-free
status endpoint — `GET /api/tls-check` — that your proxy can query before
it decides whether to request a Let's Encrypt certificate for a hostname it
doesn't already have a static site block for. This matters for Kurzly's
multi-domain model: teams register custom short-link domains dynamically
through the dashboard, so the proxy can't know the full domain list ahead
of time the way a single static `Caddyfile` block does.

Caddy supports this natively via its `on_demand_tls` global option plus an
`ask` hook. Add both a global `on_demand_tls` block and a wildcard `:443`
site that opts into on-demand issuance:

```caddyfile
{
    on_demand_tls {
        ask http://app:3000/api/tls-check
    }
}

# Your existing static site block(s) from above still work as-is and take
# precedence. Any Host Caddy does NOT already have a static block for falls
# through to this wildcard on-demand block instead.
:443 {
    tls {
        on_demand
    }
    reverse_proxy app:3000
}
```

How this works: on the *first* TLS handshake for a hostname Caddy doesn't
recognize, it calls `GET http://app:3000/api/tls-check?domain=<sni-hostname>`
— appending the hostname it just saw in the TLS SNI as the `domain` query
parameter — and only proceeds to request a Let's Encrypt certificate if
Kurzly responds `200`. A `404` (unregistered, still pending DNS
verification, or failed verification) tells Caddy to refuse the handshake
instead of provisioning a certificate for a domain nobody has verified
ownership of. Both responses are empty-bodied and carry no other
information (no target URL, no account, no distinguishing detail beyond
the status code) — Kurzly's `resolveActiveDomainByHost` guard behind this
endpoint does an exact-match, deny-by-default lookup against the `Domain`
table, so a spoofed or partial hostname can never slip through. Once
issued, the certificate is cached and renewed by Caddy as usual — the ask
endpoint is only consulted again on a fresh, previously-unseen hostname.

Use the `ask`-only form shown above — do **not** add the older
`interval`/`burst` options some examples online still show alongside
`ask`; those are deprecated in favor of Caddy's `permission` module, and
are redundant here anyway since Kurzly's own `Domain.status === 'active'`
check is already the authoritative gate on whether a certificate should be
issued.

---

## Option 2: nginx + certbot

nginx does not obtain certificates itself; run certbot separately (either
on the host or as a sidecar container) to issue and renew them, then point
nginx at the resulting certificate files.

`nginx.conf` server block:

```nginx
server {
    listen 80;
    server_name kurzly.example.com;

    # ACME HTTP-01 challenge path — certbot needs this reachable over
    # plain HTTP even after you also serve HTTPS below.
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name kurzly.example.com;

    ssl_certificate     /etc/letsencrypt/live/kurzly.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kurzly.example.com/privkey.pem;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Issue the initial certificate with certbot's webroot plugin (run once, then
let certbot's own cron/systemd timer or container handle renewal):

```bash
certbot certonly --webroot -w /var/www/certbot \
  -d kurzly.example.com \
  --email you@example.com --agree-tos --non-interactive
```

If running certbot as a container, mount the same `/etc/letsencrypt` and
`/var/www/certbot` volumes into both the certbot and nginx containers so
issued certificates and the ACME challenge path are visible to nginx.
Repeat the `server_name` / certificate pair (or use a wildcard cert) for
each additional custom short-link domain.

---

## Option 3: Traefik (labels-based, automatic HTTPS)

Traefik discovers routing config from Docker labels on the `app` service
itself — no separate config file to maintain per domain, and it handles
Let's Encrypt issuance/renewal automatically like Caddy.

Add a `traefik` service and label the existing `app` service:

```yaml
services:
  traefik:
    image: traefik:v3.1
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entryPoint.to=websecure"
      - "--entrypoints.web.http.redirections.entryPoint.scheme=https"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=you@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/letsencrypt

  app:
    build: .
    restart: unless-stopped
    # ... existing depends_on / env_file / healthcheck from docker-compose.yml ...
    # Do NOT publish "3000:3000" to the host when Traefik is fronting the
    # app — let Traefik be the only bound port on 80/443, and route to
    # `app` purely over the internal Docker network.
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.kurzly.rule=Host(`kurzly.example.com`)"
      - "traefik.http.routers.kurzly.entrypoints=websecure"
      - "traefik.http.routers.kurzly.tls.certresolver=letsencrypt"
      - "traefik.http.services.kurzly.loadbalancer.server.port=3000"

volumes:
  traefik-certs:
```

For each additional custom short-link domain, add another router with its
own `Host(...)` rule (or extend the existing rule with `||`) pointing at
the same `kurzly` service — Traefik will request a separate Let's Encrypt
certificate per new hostname automatically.

Mounting the Docker socket gives Traefik read access to container labels
across the host; if that's an unacceptable trust boundary for your
deployment, use the file-based (non-Docker) provider instead and maintain
static router config the same way as the nginx example above.

### Dynamic domains with Traefik / certbot (no native `ask` webhook)

Unlike Caddy, Traefik has no built-in equivalent to `on_demand_tls.ask` —
it does not expose a webhook a client can veto certificate issuance
through. If you're hosting multiple dynamically-registered custom
short-link domains behind Traefik (or a generic nginx+certbot setup), the
practical options are:

- **Traefik file provider + a small polling script:** run a lightweight
  script (a cron job or sidecar container) that periodically calls
  `GET /api/domains`, filters for `status === "active"`, and rewrites a
  dynamic-config file (Traefik's file provider) with one router per active
  hostname. Traefik picks up file-provider changes automatically without a
  restart. This keeps issuance in sync with Kurzly's verified-domain state
  without needing a real-time `ask` hook.
- **certbot, polled the same way:** if you're on the nginx+certbot setup
  from Option 2 instead, the same polling script can drive a
  `certbot certonly --webroot -d <hostname>` call per newly-active domain
  it discovers, then reload nginx.

Either way, only issue certificates for domains `GET /api/domains` (or,
per-domain, `GET /api/tls-check?domain=<hostname>` returning `200`)
reports as verified/active — never issue a certificate purely because a
domain row exists in `pending` state, since that means DNS ownership
hasn't been proven yet.

---

## Do not remove the database volume on routine restarts

Regardless of which proxy you choose, restarting or redeploying the stack
should only ever use:

```bash
docker compose down
docker compose up -d
```

**Never** run `docker compose down -v` (or otherwise remove the `db-data`
volume) as part of a routine restart or proxy reconfiguration — that
destroys Postgres's persistent data volume and violates the durability
guarantee this project provides (INFRA-03). Reserve `-v` for intentional,
deliberate resets where data loss is expected and acceptable.
