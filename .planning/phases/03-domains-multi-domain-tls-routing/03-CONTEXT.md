# Phase 3: Domains & Multi-Domain TLS Routing - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Admins registrieren eigene Domains/Subdomains, verifizieren sie per DNS und Kurzly führt die Domain-Ebene, gegen die die Redirect-Engine später jeden Request auflöst. **TLS-Zertifikate stellt der Betreiber-Reverse-Proxy on-demand aus** (nicht Kurzly selbst) — Kurzly liefert Registrierung, Verifizierung, Anleitung und den *verifizierten Status*, der die Zertifikatsausstellung gated.

**Requirements:** DOMAIN-01 (Domain registrieren → Status „DNS ausstehend"), DOMAIN-02 (DNS/CNAME prüfen → „Aktiv"), DOMAIN-03 (**umformuliert**, siehe D-01: verifizierter Status gated die on-demand-TLS-Ausstellung des Betreiber-Proxys — kein in-app-ACME), DOMAIN-04 (pro-Domain-DNS-Anleitung).

**In scope:** Domain-Registrierung + Lebenszyklus-Status (ausstehend/aktiv/fehlgeschlagen); DNS-Verifizierung (CNAME für Subdomains, A/ALIAS für Apex); pro-Domain-Anleitung mit dem passenden Record; ein leichter Status-/`ask`-Endpoint für den Betreiber-Proxy; Autorisierung über den Phase-2-Kern.

**Out of scope (spätere/andere Phasen):** in-app-ACME / eigene TLS-Terminierung durch Kurzly (bewusst Betreiber-Sache); die eigentliche Redirect-Auflösung Host→Domain→Slug (Redirect-Engine-Phase); Links/QR auf den Domains (Feature-Phasen); Wildcard-Domains.
</domain>

<decisions>
## Implementation Decisions

### TLS-Delivery (Scope-Neubewertung — löst den Phase-1-Konflikt)
- **D-01:** **TLS bleibt Betreiber-Sache** (konsistent mit Phase-1 D-03/D-04). Kurzly baut **kein** in-app-ACME und terminiert kein TLS. **DOMAIN-03 wird umformuliert:** statt „System stellt automatisch Zertifikate aus" liefert Kurzly (a) den verifizierten Domain-Status und (b) einen leichten **`ask`-/Status-Endpoint** (z. B. `GET /api/tls-check?domain=<host>` → 200 wenn verifiziert & aktiv, sonst 404/403), den ein Betreiber-Reverse-Proxy mit **On-Demand-TLS** (Caddy `on_demand_tls.ask`, Traefik-certresolver o. ä.) abfragt, um Zertifikate **nur für verifizierte Domains** on-demand auszustellen. Kurzly **dokumentiert** dieses Muster (Erweiterung von `docs/deployment/reverse-proxy.md` aus Phase 1).
  > **Roadmap-/Requirements-Flag:** DOMAIN-03 in REQUIREMENTS.md/ROADMAP.md sollte auf diese betreiber-delegierte Formulierung angepasst werden (das „automatisch" wird zum „on-demand durch den Betreiber-Proxy, gated durch Kurzlys verifizierten Status").

### Domain-Typen & Verifizierung
- **D-02:** Unterstützt werden **beide**: **Subdomains via CNAME** (auf ein festes, dokumentiertes Ziel) **und Apex-Domains via A-Record** (feste dokumentierte IP) bzw. ALIAS. Die pro-Domain-Anleitung (DOMAIN-04) zeigt den je Typ korrekten Record.
- **D-03:** DNS-Verifizierung per **on-demand „Jetzt prüfen"-Aktion** (DNS-Lookup des erwarteten CNAME-/A-Records) + Statusanzeige (ausstehend/aktiv/fehlgeschlagen). Periodischer Re-Check ist optional (Claude's Discretion). SSRF-/Missbrauchs-Schutz beim DNS-Check beachten (nur DNS-Auflösung, keine HTTP-Fetches gegen beliebige Hosts).

### Autorisierung (nutzt den Phase-2-Kern)
- **D-04:** Nur **owner/admin** dürfen Domains registrieren, verifizieren und löschen — über `requireDomainAccess(userId, domainId, 'admin')` bzw. beim Anlegen die Org/Team-Ownership; **member** nutzen Domains nur (nicht verwalten). Neu angelegte Domains werden der Org/dem Team des Erstellers zugeordnet.

### Claude's Discretion
- DNS-Lookup-Umsetzung (Node `dns.resolveCname`/`resolve4`), exaktes Domain-Schema (erweitert die minimale `Domain` aus Phase 2 um `status`, `type` (subdomain/apex), `verificationTarget`/erwarteter Record, `verifiedAt`, Timestamps), genaue Signatur des `ask`-/Status-Endpoints, Caching/Rate-Limiting der DNS-Checks, UI-Details der Domain-Liste + Anleitung — Researcher/Planner auf Basis CLAUDE.md (Caddy/TLS- & SSRF-Research).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/PROJECT.md` — Constraints (Security/TLS, Datenhoheit), Key Decisions.
- `.planning/REQUIREMENTS.md` — DOMAIN-01…04 (DOMAIN-03 gemäß D-01 umformulieren).
- `.planning/ROADMAP.md` §Phase 3 — Goal & Success Criteria.
- `.claude/CLAUDE.md` — Caddy/Let's-Encrypt-TLS-Research, SSRF-Prevention, Reverse-Proxy-Deployment-Patterns.
- `docs/deployment/reverse-proxy.md` — (aus Phase 1) Betreiber-Proxy-Beispiele; hier um On-Demand-TLS-`ask`-Integration erweitern.
- Phase-2-Artefakte: der Autorisierungskern `requireDomainAccess`/`scopedDomainIds` und das minimale `Domain`/`DomainMembership`-Schema, das hier erweitert wird.
- `design_handoff_url_shortener/Kurzly Prototyp.dc.html` — Domain-Screens/Anleitung im Prototyp (falls vorhanden).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-2-Autorisierungskern** (`requireDomainAccess`/`scopedDomainIds`) ist der einzige Autorisierungspfad — Domain-Verwaltung nutzt ihn mit `minRole='admin'`.
- **Phase-2-`Domain`/`DomainMembership`-Schema** wird hier um Status/Typ/Verifizierung erweitert (nicht neu angelegt).
- **Phase-1-Reverse-Proxy-Doku** (`docs/deployment/reverse-proxy.md`) — Basis für das On-Demand-TLS-Muster.
- **testcontainers-Harness** — DNS-Verifizierungs-/Status-Logik gegen echtes Postgres unit-/integrationstesten (DNS-Lookups in Tests mocken/stubben).

### Integration Points
- Der verifizierte Domain-Status ist die Quelle, gegen die (a) der Betreiber-Proxy TLS gated und (b) später die Redirect-Engine Host→Domain auflöst — Schema/Status hier stabil halten.
</code_context>

<specifics>
## Specific Ideas

- „Automatisches TLS" wird durch das Zusammenspiel **Kurzly-Verifizierung + Betreiber-Proxy-On-Demand-TLS** erreicht, nicht durch Kurzly-eigene ACME-Integration — self-hosted-freundlich, kein zusätzlicher TLS-Angriffs-/Betriebsaufwand im Produkt.
- Der `ask`-Endpoint ist reine Statusauskunft (verifiziert ja/nein) — er terminiert kein TLS und leakt keine Ziel-URLs.
</specifics>

<deferred>
## Deferred Ideas

- **In-app-ACME / Kurzly als TLS-Terminator** — bewusst nicht (Betreiber-Delegation, Phase-1-konsistent).
- **Wildcard-Domains** und mehrere Domains pro Redirect-Ziel — spätere Bewertung.
- **Periodischer automatischer DNS-Re-Check** (statt nur on-demand) — optional, Discretion.
</deferred>

---

*Phase: 3-domains-multi-domain-tls-routing*
*Context gathered: 2026-07-11*
