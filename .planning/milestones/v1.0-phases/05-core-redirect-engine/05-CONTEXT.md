# Phase 5: Core Redirect Engine - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Jeder Besuch eines Kurzlinks löst über die konkret besuchte eigene Domain korrekt, sicher und schnell auf — der erklärte Core Value des Projekts. Die feste Status-Code-Präzedenz **Ablauf (410 Gone) → Passwort-Gate → Bot/OG-Zweig → 302-Redirect** wird durchgesetzt, **ohne dass ein geschütztes oder abgelaufenes Ziel jemals vor der Prüfung im HTML/JSON/Header erscheint** (bewiesen durch No-Leak-Canary-Test mit distinktiver Ziel-URL).

**Requirements:** REDIR-01 (302 auf Ziel-URL), REDIR-02 (host-basiert pro Domain gescoped), REDIR-03 (abgelaufen → 410 Gone mit Ablauf-Seite, kein Redirect), REDIR-04 (Passwort-Seite; Ziel erst nach serverseitig geprüftem, gehashtem Passwort), REDIR-05 (Bots erhalten injizierte OG-Tags ohne Redirect; geschützte/abgelaufene Ziele nie vor Prüfung preisgegeben), UI-04 (öffentliche Passwort-Seite), UI-05 (öffentliche Ablauf-Seite).

**In scope:**
- Ersetzt den Redirect-Stub (`apps/api/src/routes/redirect.ts`) durch die echte Engine.
- Host→Domain-Auflösung ausschließlich über `resolveActiveDomainByHost()` (Phase 3, deny-by-default, eingefrorene Signatur); Slug→Link-Lookup unique-per-domain.
- Schema-Erweiterung des `Link`-Modells: `passwordHash` (bcrypt), `expiresAt` (Tagesgranularität), `forwardQuery` (Boolean).
- **Voll in bestehendes Link-Formular integriert:** Passwort + Ablaufdatum + Query-Weitergabe-Checkbox in Erstellen/Bearbeiten (Phase 4 UI) — Redirect-Engine sofort end-to-end nutzbar.
- Öffentliche, server-gerenderte HTML-Seiten (außerhalb SPA): Passwort-Seite (UI-04), Ablauf-Seite (UI-05), generische 404-Seite; Prototyp-Design, konfigurierbares Branding.
- Passwort-Gate-Flow: GET zeigt Seite ohne Ziel → POST-Verify (rate-limited) → Session-Cookie (link-gebunden) → 302.
- Bot/Crawler-Erkennung (UA-Bibliothek) + generische Kurzly-OG-HTML-Auslieferung; Bots nie per 302 weitergeleitet.
- Präzedenz-Enforcement + No-Leak-Canary-Test; `Cache-Control: no-store` auf allen Redirect-/Public-Antworten.
- Saubere Naht (Hook-Punkt) für späteres Klick-Tracking, ohne selbst zu tracken.

**Out of scope (spätere Phasen):**
- **META-02** (Custom-OG-Tags pro Link im Dashboard setzen + Social-Card-Vorschau) — UTM/OG-Metadaten-Phase; Phase 5 liefert nur **generische** OG-Tags.
- Tatsächliches Klick-Tracking / Analytics-Daten (Phase 6 — hier nur die Naht).
- Dynamische QR-Codes / Remapping (QR-Phase; `no-store` bereitet es vor).
- UTM-Builder (bereits Phase 4 in Ziel-URL eingebacken).

</domain>

<decisions>
## Implementation Decisions

### Scope: Passwort & Ablauf setzen
- **D-01:** Passwort **und** Ablaufdatum werden in Phase 5 **voll ins bestehende Link-Erstellen/Bearbeiten-Formular** (Phase 4) integriert — nicht nur Backend/API. Ziel: Redirect-Engine ist sofort end-to-end nutzbar (Nutzer legt echte geschützte/ablaufende Links an).
- **D-02:** Link-Passwörter werden mit **bcrypt** serverseitig gehasht (Cost-Faktor konfigurierbar). Nie im Klartext gespeichert oder ausgeliefert.
- **D-03:** `expiresAt` mit **Tagesgranularität** (nur Datum wählbar); Link läuft am Ende des gewählten Tages ab. Ablauf-Vergleich serverseitig. Timezone-Handling (Ende welchen Tages/UTC vs. lokal) = Discretion des Planners.

### Bot/Crawler & OG-Strategie
- **D-04:** Crawler-Erkennung via **etablierter User-Agent-Bibliothek** (isbot-artig) — deckt facebookexternalhit, Twitterbot, Slackbot, WhatsApp, LinkedInBot, Googlebot, Discordbot usw. ab. Konkrete Lib = Researcher/Planner.
- **D-05:** Ein normaler Link liefert Bots in Phase 5 **generische, markierte Kurzly-OG-Tags** (kein Custom-OG — das kommt erst mit META-02). REDIR-05 wird so ohne Vorziehen von META-02 erfüllt; Custom-Werte werden später eingehängt.
- **D-06:** Ein erkannter Bot wird **NIE per 302 weitergeleitet** — er erhält immer eine **200-HTML-Seite mit OG-Tags**. Nur echte Browser bekommen den 302 aufs Ziel. Für geschützte/abgelaufene Links erhält der Bot generische OG-Tags **ohne** das echte Ziel/ohne Redirect (No-Leak).

### Passwort-Gate-Flow
- **D-07:** Ablauf: **GET** der geschützten Link-URL zeigt die Passwort-Seite (Ziel **nicht** im HTML). Formular macht **POST an einen Verify-Endpoint**; bei korrektem bcrypt-Match setzt der Server ein Cookie und antwortet mit 302. Falsches Passwort → gleiche Seite mit Fehler, **kein** Ziel-Leak.
- **D-08:** Nach korrektem Passwort wird ein **kurzlebiges, strikt link-gebundenes Cookie/Token** gesetzt; folgender Aufruf/Reload innerhalb der Gültigkeit fragt nicht erneut. **TTL = Browser-Session** (Session-Cookie), link-gebunden.

### Öffentliche Seiten & Branding
- **D-09:** Passwort- (UI-04), Ablauf- (UI-05) und 404-Seiten werden als **eigenständiges, server-gerendertes HTML** von Fastify ausgeliefert — **kein** SPA-Bundle, kein Auth, kein clientseitiges Einbetten von Zieldaten. Gleiche Render-Schicht wie der Bot-OG-HTML-Pfad.
- **D-10:** Design folgt dem **Kurzly-Prototyp** (Geist-Typo, Lime-Akzent `#d7ff01`, Light/Dark); Brandname/Akzent bleiben über die bestehenden Prototyp-Props/ENV **konfigurierbar**.
- **D-11:** Unbekannter Slug auf einer Domain → **generische, gebrandete 404-Seite** (kein Ziel, keine Info-Preisgabe); „existiert nicht" und „kein Zugriff" sind für den Besucher ununterscheidbar.

### Query-Weitergabe (pro Link)
- **D-12:** Neues Link-Feld **`forwardQuery` (Boolean, Default: aus)** + Checkbox „Query-Parameter an Ziel-URL weitergeben" im Link-Formular. Aktiv → eingehende Query-Parameter werden an die gespeicherte Ziel-URL gemerged; inaktiv → Ziel exakt wie gespeichert.
- **D-13:** Merge-Konfliktregel: **Ziel-URL gewinnt** — in der Ziel-URL gespeicherte Parameter (z. B. eingebackene UTM aus Phase 4) bleiben unangetastet; nur nicht bereits vorhandene eingehende Parameter werden ergänzt.

### Präzedenz & Sicherheit
- **D-14:** Feste Auswertungsreihenfolge: **Ablauf (410) → Passwort-Gate → Bot/OG-Zweig → 302-Redirect.** Ein geschütztes/abgelaufenes Ziel darf in keiner Response (HTML/JSON/Header) vor bestandener Prüfung erscheinen — verifiziert durch einen **No-Leak-Canary-Test** mit distinktiver Ziel-URL.

### Rate-Limiting
- **D-15:** Passwort-Verify-Endpoint ist brute-force-geschützt **pro (IP, Link)** (@fastify/rate-limit, bereits im Stack) — wenige Fehlversuche/Minute mit Backoff, ohne legitime Besucher anderer Links zu treffen. Schwellen = Discretion.
- **D-16:** Der öffentliche Redirect-Handler (302-Pfad) erhält ein **großzügiges Pro-IP-Abuse-/DoS-Limit**, das echte Nutzer nie spüren — der Redirect ist der Kernwert und muss schnell/verfügbar bleiben.

### Tracking-Naht (Vorbereitung Phase 6)
- **D-17:** Phase 5 strukturiert den erfolgreichen Redirect so, dass Phase 6 einen **Klick-Tracking-Hook sauber einhängen** kann (klar definierter „hier würde getrackt"-Punkt), schreibt aber selbst **keine** Tracking-Daten. Vermeidet späteres Aufreißen des Core-Pfads.

### Caching
- **D-18:** Alle Redirect-Antworten (302) sowie Ablauf-/Passwort-/404-Seiten setzen **`Cache-Control: no-store`/no-cache**, damit umgestellte Ziele (späteres dynamisches QR-Remapping) sofort greifen und Browser/CDN kein altes oder leak-sensitives Ergebnis cachen.

### Claude's Discretion
- Exakte bcrypt-Cost-Faktor-Wahl; Timezone-/„Ende des Tages"-Semantik für `expiresAt`; konkrete UA-Bot-Bibliothek; genaue Endpoint-Struktur des Verify-Pfads (ein Route vs. getrennt); Rate-Limit-Schwellen/Backoff-Werte; exakte Cache-Header-Kombination; genaue Cookie-Attribute (HttpOnly/SameSite/Secure/Path) und Namensschema; Query-Merge-Encoding-Edge-Cases; die konkrete Render-Technik der server-gerenderten HTML-Seiten (Template-Strings vs. leichte View-Engine).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projekt- & Anforderungsbasis
- `.planning/PROJECT.md` — Core Value (Redirect-Handler korrekt & schnell), Security-Constraints (Passwörter gehasht; geschützte/abgelaufene Ziele nie vor Prüfung im HTML; kein OG-Preview vor Entsperrung).
- `.planning/REQUIREMENTS.md` — REDIR-01…05, UI-04, UI-05 (und META-02 als *out of scope*-Referenz).
- `.planning/ROADMAP.md` §Phase 5 — Goal & Success Criteria (Präzedenz, No-Leak, Bot/OG-Verhalten).
- `.claude/CLAUDE.md` — Stack (Fastify v5/Prisma 7/Vue 3), @fastify/rate-limit, @fastify/helmet/CSP-Hinweise, Redirect-/OG-HTML-Sicherheitsnotizen.

### Phasen-Artefakte (Reuse)
- `apps/api/src/lib/domainResolution.ts` — `resolveActiveDomainByHost()` (Phase 3, **eingefrorene Signatur**, deny-by-default Host→Domain-Auflösung) — DER Einstieg der Engine.
- `apps/api/src/lib/hostname.ts` — `normalizeHostname()` (kanonische Host-Form; identisch zu dem, was Domains persistiert).
- `apps/api/src/routes/redirect.ts` — der zu **ersetzende** Stub.
- `apps/api/src/lib/links.ts` + `apps/api/src/routes/links.ts` — geteilter `createLink`-Service/Validator + Link-CRUD; hier werden `passwordHash`/`expiresAt`/`forwardQuery`-Felder + Formular-Handling ergänzt (Phase 4, ein autorisierter Pfad).
- `apps/api/prisma/schema.prisma` — `model Link` (aktuell ohne password/expiry/forwardQuery; unique `@@unique([domainId, slug])`).
- Phase-4-Artefakt: `.planning/phases/04-links-management-bulk-import/04-CONTEXT.md` — Reserved-Slugs, „Bulk = kein Bypass", Slug-Editierbarkeit (Vorbereitung QR-Remapping).

### Design
- `design_handoff_url_shortener/Kurzly Prototyp.dc.html` — maßgeblich für Passwort-Seite (UI-04), Ablauf-Seite (UI-05), 404-Seite, Link-Formular-Erweiterung (Passwort/Ablauf/Query-Checkbox), Branding-Tokens.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`resolveActiveDomainByHost()` (Phase 3)** — einziger Host→Domain-Auflösungspfad; die Engine startet damit (Port-Strip + Normalisierung + exakter, aktiver Match). Signatur eingefroren.
- **`createLink`-Service (`lib/links.ts`, Phase 4)** — ein autorisierter Erstellungs-/Bearbeitungspfad; neue Felder (Passwort/Ablauf/forwardQuery) laufen durch dieselbe Validierung (manuell + Bulk).
- **Reserved-Slug-Schutz (Phase 4)** — verhindert, dass Links System-/Redirect-Routen überschatten; relevant, damit die neuen öffentlichen Public-/Verify-Routen nicht kollidieren.
- **testcontainers-Harness** — echtes Postgres für TDD des Redirect-Pfads, Ablauf-410, Passwort-Gate und v. a. den No-Leak-Canary.
- **@fastify/rate-limit / @fastify/helmet** — bereits im Stack für Verify-/Redirect-Limits und CSP der OG-/Public-HTML.
- **Geteilte DTOs (`packages/shared`)** — Link-Typen zwischen `apps/web` und `apps/api`; um neue Felder erweitern.

### Established Patterns
- **Deny-by-default** (authorization.ts / domainResolution.ts): Abwesenheit eines exakten Match = Ablehnung, nie Fallback — auf Slug-Lookup übertragen.
- **Ein autorisierter Pfad** (Phase 4): keine parallelen Bypässe; neue Setz-Felder gehen durch `createLink`/`updateLink`.

### Integration Points
- Der neue Redirect-Handler ersetzt `routes/redirect.ts` und ist der Integrationspunkt für Host+Slug→Link-Auflösung.
- Der Tracking-Hook-Punkt (D-17) ist die definierte Naht für Phase 6.
- Die server-gerenderte HTML-Schicht wird von Passwort-/Ablauf-/404-Seite **und** dem Bot-OG-Pfad geteilt.

</code_context>

<specifics>
## Specific Ideas

- **No-Leak ist der Sicherheitsanker:** GET der geschützten Seite enthält niemals das Ziel; erst POST-Verify (bcrypt) → Session-Cookie → 302. Canary-Test mit distinktiver Ziel-URL beweist es (REDIR-04/05, Success Criterion 3/4).
- **Bots bekommen nie 302** — immer 200-OG-HTML; geschützt/abgelaufen → generische OG ohne echtes Ziel.
- **`forwardQuery` per Checkbox am Link** (Nutzerwunsch), Default aus, Ziel-URL gewinnt bei Konflikt — schützt kuratierte UTM.
- **`no-store` überall** bereitet dynamisches QR-Remapping (spätere Phase) vor: umgestellte Ziele greifen sofort.
- **Saubere Tracking-Naht jetzt**, damit Phase 6 den Core-Redirect-Pfad nicht erneut aufreißen muss.

</specifics>

<deferred>
## Deferred Ideas

- **META-02 — Custom-OG-Tags pro Link** (Titel/Beschreibung/Bild-URL) im Dashboard + Social-Card-Vorschau → UTM/OG-Metadaten-Phase. Phase 5 liefert bewusst nur generische OG-Tags; Custom-Werte werden dort eingehängt.
- **Tatsächliches Klick-Tracking / Analytics** → Phase 6 (Phase 5 stellt nur die Naht bereit).
- **Dynamische QR-Codes / Remapping** → QR-Phase (`no-store` ist die Vorbereitung).
- **Query-Merge-Feinsteuerung** über die einfache „Ziel-URL gewinnt"-Regel hinaus (z. B. Allow-/Denylist einzelner Parameter) → bei Bedarf spätere Phase.

</deferred>

---

*Phase: 5-core-redirect-engine*
*Context gathered: 2026-07-12*
