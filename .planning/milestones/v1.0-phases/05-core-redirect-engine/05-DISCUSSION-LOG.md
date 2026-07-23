# Phase 5: Core Redirect Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-12
**Phase:** 5-core-redirect-engine
**Areas discussed:** Scope Passwort/Ablauf setzen, Bot/Crawler & OG-Strategie, Passwort-Gate-Flow, Öffentliche Seiten & Branding, Edge-Verhalten (unknown slug + Query), Rate-Limiting, Cookie-Gültigkeit, Tracking-Naht, Caching-Header

---

## Scope: Passwort/Ablauf setzen

| Option | Description | Selected |
|--------|-------------|----------|
| Voll ins Link-Formular | Passwort + Ablaufdatum jetzt schon im Link-Formular setzbar; sofort end-to-end nutzbar | ✓ |
| Nur Redirect + minimaler Setzweg | Nur Schema + Redirect-Enforcement, UI später | |
| Du entscheidest | Planner grenzt ab | |

**User's choice:** Voll ins Link-Formular
**Notes:** Redirect-Engine soll sofort end-to-end nutzbar sein — Nutzer legt echte geschützte/ablaufende Links an.

## Hashing

| Option | Description | Selected |
|--------|-------------|----------|
| bcrypt | Bewährt, breit auditiert, einfache Node-Lib | ✓ |
| argon2 | Modern, schwerere native Abhängigkeit | |
| better-auth-Mechanismus | Evtl. nicht sauber verfügbar (Magic-Link nutzt keine Passwörter) | |

**User's choice:** bcrypt

## Ablauf-Granularität

| Option | Description | Selected |
|--------|-------------|----------|
| Datum + Uhrzeit | Timestamp, präzise | |
| Nur Datum (Tagesgranularität) | Läuft am Ende des gewählten Tages ab | ✓ |
| Du entscheidest | Planner/Prototyp | |

**User's choice:** Nur Datum (Tagesgranularität)

## OG für normale Links (META-02-Timing)

| Option | Description | Selected |
|--------|-------------|----------|
| Generische Kurzly-OG-Tags | Custom-OG erst mit META-02; Phase 5 liefert generische Tags | ✓ |
| OG-Felder jetzt mitbauen | Zieht META-02 vor (Scope-Creep) | |
| Du entscheidest | Planner | |

**User's choice:** Generische Kurzly-OG-Tags
**Notes:** Vermeidet Vorziehen von META-02, kein Scope-Creep.

## Bot-Erkennung

| Option | Description | Selected |
|--------|-------------|----------|
| User-Agent-Bibliothek | isbot-artig, wartbar, deckt Social-Bots ab | ✓ |
| Eigene kleine UA-Allowlist | Handgepflegt, Lücken-Risiko | |
| Du entscheidest | Researcher/Planner | |

**User's choice:** User-Agent-Bibliothek

## Bot auf normalem Link

| Option | Description | Selected |
|--------|-------------|----------|
| OG-HTML, kein Redirect (200) | Spec-konform (REDIR-05); Bots nie 302 | ✓ |
| Bot wird auch weitergeleitet | Widerspricht REDIR-05 | |

**User's choice:** OG-HTML, kein Redirect (200)

## Passwort-Gate-Flow (State)

| Option | Description | Selected |
|--------|-------------|----------|
| Kurzlebiges Cookie/Token | Nach korrektem Passwort link-gebundenes Cookie → 302; Reload fragt nicht erneut | ✓ |
| Sofort 302, kein State | Kein Cookie; jeder Reload fragt erneut | |
| Du entscheidest | Researcher/Planner | |

**User's choice:** Kurzlebiges Cookie/Token

## Passwort-Verify Request-Flow

| Option | Description | Selected |
|--------|-------------|----------|
| POST an Verify-Endpoint | GET zeigt Seite ohne Ziel; POST verifiziert, setzt Cookie, 302; rate-limited | ✓ |
| Du entscheidest | Planner (No-Leak + Rate-Limit fest) | |

**User's choice:** POST an Verify-Endpoint

## Rendering öffentliche Seiten

| Option | Description | Selected |
|--------|-------------|----------|
| Server-gerendertes HTML | Eigenständige minimale HTML-Seiten, kein SPA, kein Leak | ✓ |
| SPA-Route wiederverwenden | Lädt Dashboard-Bundle, Leak-Risiko | |
| Du entscheidest | Researcher/Planner | |

**User's choice:** Server-gerendertes HTML

## Branding

| Option | Description | Selected |
|--------|-------------|----------|
| Prototyp-Design, konfigurierbar | Kurzly-Prototyp; Brand/Akzent per Props/ENV konfigurierbar | ✓ |
| Neutral/minimal | Fast ungebrandet | |
| Du entscheidest | UI-Spec/Prototyp | |

**User's choice:** Prototyp-Design, konfigurierbar

## Unbekannter Slug

| Option | Description | Selected |
|--------|-------------|----------|
| Generische 404-Seite | Gebrandet, keine Info-Preisgabe; nicht unterscheidbar von „kein Zugriff" | ✓ |
| Du entscheidest | Planner/UI-Spec | |

**User's choice:** Generische 404-Seite

## Query-Weitergabe

| Option | Description | Selected |
|--------|-------------|----------|
| Nicht weitergeben | Ziel exakt wie gespeichert | |
| Eingehende Query anhängen/mergen | Merge, Edge-Cases | |
| Du entscheidest | Researcher/Planner | |

**User's choice:** *Free-Text* — „Wäre cool wenn man das über eine Checkbox am Link selbst setzen kann"
**Notes:** Neues `forwardQuery`-Boolean-Feld + Checkbox im Link-Formular (Default aus). Reflektiert & bestätigt; Aufwand (Merge-Logik in Phase 5) als vertretbar akzeptiert.

## Query-Merge-Konfliktregel

| Option | Description | Selected |
|--------|-------------|----------|
| Ziel-URL gewinnt | Gespeicherte (UTM-)Parameter unangetastet; nur fehlende ergänzt | ✓ |
| Eingehende Query gewinnt | Überschreibt gleichnamige Zielparameter | |
| Du entscheidest | Researcher/Planner | |

**User's choice:** Ziel-URL gewinnt

## Rate-Limiting Passwort-Verify

| Option | Description | Selected |
|--------|-------------|----------|
| Pro IP + pro Link | Fehlversuche pro (IP, Link) begrenzt, Backoff | ✓ |
| Nur pro IP | Grobes globales IP-Limit | |
| Du entscheidest | Researcher/Planner | |

**User's choice:** Pro IP + pro Link

## Rate-Limiting Redirect-Handler

| Option | Description | Selected |
|--------|-------------|----------|
| Großzügiges Abuse-Limit | Hohes Pro-IP-Limit als DoS-Bremse, für echte Nutzer unspürbar | ✓ |
| Kein Limit auf Redirect | 302-Pfad ungedrosselt | |
| Du entscheidest | Planner | |

**User's choice:** Großzügiges Abuse-Limit

## Cookie-Gültigkeit

| Option | Description | Selected |
|--------|-------------|----------|
| Wenige Stunden | Kurzlebig ~1–4 h, link-gebunden | |
| Nur Browser-Session | Session-Cookie bis Browser-Schließen | ✓ |
| Du entscheidest | Planner (link-gebunden fest) | |

**User's choice:** Nur Browser-Session

## Tracking-Naht (Phase 6)

| Option | Description | Selected |
|--------|-------------|----------|
| Saubere Naht vorsehen | Hook-Punkt für Phase-6-Tracking, aber selbst keine Daten schreiben | ✓ |
| Strikt nichts | Phase 6 refactored Core-Pfad später selbst | |
| Du entscheidest | Researcher/Planner | |

**User's choice:** Saubere Naht vorsehen

## Caching-Header

| Option | Description | Selected |
|--------|-------------|----------|
| no-store auf 302 | Redirects + Public-Seiten no-store; umgestellte Ziele greifen sofort, kein Leak-Caching | ✓ |
| Du entscheidest | Researcher/Planner (No-Store-Prinzip fest) | |

**User's choice:** no-store auf 302

---

## Claude's Discretion

- bcrypt-Cost-Faktor; Timezone-/„Ende des Tages"-Semantik für `expiresAt`; konkrete UA-Bot-Bibliothek; Verify-Endpoint-Struktur; Rate-Limit-Schwellen/Backoff; exakte Cache-Header-Kombination; Cookie-Attribute (HttpOnly/SameSite/Secure/Path) + Namensschema; Query-Merge-Encoding-Edge-Cases; Render-Technik der HTML-Seiten.

## Deferred Ideas

- META-02 (Custom-OG-Tags pro Link + Social-Card-Vorschau) → UTM/OG-Metadaten-Phase.
- Tatsächliches Klick-Tracking/Analytics → Phase 6.
- Dynamische QR-Codes/Remapping → QR-Phase.
- Query-Merge-Feinsteuerung (Parameter-Allow-/Denylist) → bei Bedarf spätere Phase.
