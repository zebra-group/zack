# Phase 6: Internal Tracking & Analytics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-12
**Phase:** 6-internal-tracking-analytics
**Areas discussed:** Länder-Ableitung lokal, Besucher-Datenschutzmodell, Event-Datenmodell & Zero-Rows, QR-Scans-Naht (Phase 7)

---

## Länder-Ableitung lokal (GeoIP)

### Frage 1 — GeoIP-Quelle & Image-Integration
| Option | Description | Selected |
|--------|-------------|----------|
| DB-IP Lite, gebündelt | DB-IP Country Lite (CC-BY 4.0), im Image-Build gebacken, kein Account/Key | ✓ |
| MaxMind GeoLite2 | Verbreiteter/genauer, aber Account + Lizenzschlüssel + EULA nötig | |
| Optional per ENV-Pfad | Keine DB im Image; Betreiber mountet optional, sonst „Unbekannt" | |

**User's choice:** DB-IP Lite, gebündelt
**Notes:** CC-BY 4.0 passt zum „docker compose up"-Anspruch (kein Signup); Attribution im Footer/README.

### Frage 2 — Randfälle & Override
| Option | Description | Selected |
|--------|-------------|----------|
| 'Unbekannt' + ENV-Override | Nicht auflösbar → „Unbekannt", Klick zählt weiter; `GEOIP_DB_PATH` überschreibt gebündelte DB; echte Client-IP via trust-proxy | ✓ |
| Nur 'Unbekannt', kein Override | Wie oben, aber DB fix (nur Rebuild) | |

**User's choice:** 'Unbekannt' + ENV-Override

---

## Besucher-Datenschutzmodell

### Frage 1 — Unique-Visitor-Zählung
| Option | Description | Selected |
|--------|-------------|----------|
| Gesalzener Tages-Hash | hash(Tages-Salt|IP|UA|linkId), nur Hash gespeichert, Salt rotiert täglich, kein PII/Cookie | ✓ |
| First-Party-Cookie | Anonyme Visitor-ID im Cookie — Consent-Thematik, widerspricht privacy-first | |
| Roh-IP speichern | IP direkt persistiert — PII at rest, DSGVO-Risiko | |

**User's choice:** Gesalzener Tages-Hash
**Notes:** Plausible-Stil; Unique-Fenster bewusst tagesgranular; keine Cross-Day-Re-Identifikation.

### Frage 2 — Referrer-Granularität
| Option | Description | Selected |
|--------|-------------|----------|
| Nur Quell-Host | Nur Host gespeichert (`t.co`, `google.com`), leer → „Direkt" | ✓ |
| Volle Referrer-URL | Host+Pfad+Query — Leak-Risiko, fragmentierte Top-Referrer | |

**User's choice:** Nur Quell-Host

---

## Event-Datenmodell & Zero-Rows

### Frage 1 — Datenmodell
| Option | Description | Selected |
|--------|-------------|----------|
| Roh-Event-Zeile pro Klick | ClickEvent(linkId, createdAt, country, referrerHost, visitorHash, source); „aus" → kein INSERT | ✓ |
| Nur aggregierte Zähler | Counter-Tabellen; Uniques schwer, Zero-Rows weniger beweisbar | |

**User's choice:** Roh-Event-Zeile pro Klick
**Notes:** Passt exakt zur D-17-Naht; Analytics live per SQL-Aggregation.

### Frage 2 — Toggle-off-Verhalten
| Option | Description | Selected |
|--------|-------------|----------|
| Behalten (nur Stopp) | Nur künftige Writes stoppen, Historie bleibt sichtbar | ✓ |
| Historie löschen | DELETE aller Events des Links — destruktiv/unumkehrbar | |
| Löschen mit Rückfrage | UI-Dialog Stoppen vs. Stoppen+Löschen — mehr UI-Aufwand | |

**User's choice:** Behalten (nur Stopp)

### Frage 3 — Retention
| Option | Description | Selected |
|--------|-------------|----------|
| Unbegrenzt behalten | Kein Pruning, All-Time exakt, Tabelle wächst monoton | |
| Konfigurierbares Pruning | `CLICK_RETENTION_DAYS` (Default unbegrenzt), Cleanup-Job | ✓ |

**User's choice:** Konfigurierbares Pruning

### Frage 4 — Pruning-fester Gesamtzähler
| Option | Description | Selected |
|--------|-------------|----------|
| Lifetime-Zähler am Link | `Link.lifetimeClicks` inkrementiert beim Write; Total pruning-fest | ✓ |
| Nur Live-COUNT | Total = COUNT über Events; mit Pruning schrumpfend | |

**User's choice:** Lifetime-Zähler am Link

---

## QR-Scans-Naht (Phase 7)

### Frage 1 — QR-Scans-Metrik jetzt
| Option | Description | Selected |
|--------|-------------|----------|
| source-Feld jetzt, Wert 0 | `ClickEvent.source` (link|qr, Default link); QR-Scans = COUNT(source=qr) = 0; Phase 7 setzt Wert | ✓ |
| Feld später, jetzt Hardcoded 0 | Fixe 0; Phase 7 muss Schema doch anfassen | |

**User's choice:** source-Feld jetzt, Wert 0
**Notes:** Analog zur D-17-Naht aus Phase 5 — Phase 7 legt nur einen Flag um.

---

## Claude's Discretion

- Konkrete GeoIP-Reader-Bibliothek gegen `.mmdb`.
- Hash-Algorithmus, Tages-Salt-Persistenz/-Rotation.
- trust-proxy-Feinkonfiguration.
- Cleanup-Job-Mechanik (Retention).
- Aggregations-SQL/Query-Aufbau (raw SQL vs. Prisma groupBy), Index-Strategie auf `ClickEvent`.
- Zuschnitt der Analytics-Screens im Rahmen des Prototyp-Designs, ENV-Namensschema-Details.

## Deferred Ideas

- QR-Codes / QR-Scan-Schreibpfad → Phase 7.
- Domain-scoped Member-Autorisierung der Analytics-Endpunkte (inkl. Denial-Test) → Phase 9.
- Analytics-Export (CSV/API), Alerting, Echtzeit-Streaming, Materialized-View-Performance → spätere Phase.
- Referrer-/UTM-Kampagnen-Auswertung über den Quell-Host hinaus → spätere Analytics-Vertiefung.
