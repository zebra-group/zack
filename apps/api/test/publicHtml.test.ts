/**
 * `lib/publicHtml.ts` unit suite (D-09, RESEARCH Pattern 6, Pitfall 1) —
 * proves the single server-rendered public-HTML layer's security and copy
 * contract without any HTTP/Fastify/Prisma surface (pure module, no DB):
 *
 * 1. `escapeHtml` maps all five HTML-significant characters and neutralizes
 *    a script-injection payload — the reflected-XSS guard for the incoming
 *    (attacker-controlled, unvalidated-on-404) URL slug.
 * 2. Each of the four renderers (password/expiry/404/bot-OG) matches
 *    05-UI-SPEC.md's LOCKED copy contract, escapes every user-controlled
 *    interpolation, and never carries a link's real target URL (No-Leak,
 *    T-05-LEAK-HTML) — structurally, since none of the four ctx types has
 *    a target field.
 */
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderBotOgPage,
  renderExpiredPage,
  renderNotFoundPage,
  renderPasswordPage,
} from "../src/lib/publicHtml.js";

const SCRIPT_PAYLOAD = "<script>alert(1)</script>";
// Distinctive canary substring standing in for a link's real target URL —
// never expected to appear in any rendered output (No-Leak).
const LEAK_CANARY = "https://attacker-secret-target.example/do-not-leak-me";

describe("escapeHtml (Pitfall 1, reflected-XSS guard)", () => {
  it("escapes & first, then <, >, \", '", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("does not double-escape an already-present & when escaping other characters", () => {
    // & must be replaced first so escaping < doesn't also mangle a literal
    // "&lt;" a caller might (incorrectly) pass in — this asserts ordering.
    expect(escapeHtml("<")).not.toContain("&amp;lt;");
  });

  it("neutralizes a script-injection payload into entity-escaped output with no raw angle brackets", () => {
    const escaped = escapeHtml(SCRIPT_PAYLOAD);
    expect(escaped).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
  });

  it("passes a plain safe string (letters/digits/dot/slash) through unchanged", () => {
    expect(escapeHtml("my-domain.example.com/some-slug123")).toBe(
      "my-domain.example.com/some-slug123",
    );
  });
});

describe("renderPasswordPage (UI-04, REDIR-04)", () => {
  const baseCtx = {
    brand: "Kurzly",
    accent: "#d7ff01",
    domain: "go.example.com",
    slug: "promo",
    errorState: false,
  };

  it("renders the LOCKED title, body, url-chip, form action, and CTA copy", () => {
    const html = renderPasswordPage(baseCtx);
    expect(html).toContain("Dieser Link ist geschützt");
    expect(html).toContain("Gib das Passwort ein, um zum Ziel weitergeleitet zu werden.");
    expect(html).toContain("go.example.com/promo");
    expect(html).toContain('<form method="POST" action="/promo/verify"');
    expect(html).toContain("Weiter →");
    expect(html).toContain("Kurzly · self-hosted");
  });

  it("includes the inline error and destructive input border when errorState is true", () => {
    const html = renderPasswordPage({ ...baseCtx, errorState: true });
    expect(html).toContain("Falsches Passwort. Bitte erneut versuchen.");
    expect(html).toContain("#e5484d");
  });

  it("omits the inline error when errorState is false", () => {
    const html = renderPasswordPage(baseCtx);
    expect(html).not.toContain("Falsches Passwort. Bitte erneut versuchen.");
  });

  it("escapes a script-injection payload in the slug (url-chip and form action)", () => {
    const html = renderPasswordPage({ ...baseCtx, slug: SCRIPT_PAYLOAD });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("escapes a script-injection payload in the domain", () => {
    const html = renderPasswordPage({ ...baseCtx, domain: SCRIPT_PAYLOAD });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("never contains a distinctive target-URL canary string (No-Leak)", () => {
    const html = renderPasswordPage({ ...baseCtx, target: LEAK_CANARY } as never);
    expect(html).not.toContain(LEAK_CANARY);
  });

  it("includes the prefers-color-scheme dark media block and the Google Fonts link", () => {
    const html = renderPasswordPage(baseCtx);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("fonts.googleapis.com");
  });

  it("includes the noindex meta tag", () => {
    const html = renderPasswordPage(baseCtx);
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });
});

describe("renderExpiredPage (UI-05, REDIR-03)", () => {
  const baseCtx = {
    brand: "Kurzly",
    accent: "#d7ff01",
    domain: "go.example.com",
    slug: "summer-sale",
    expiresAt: new Date("2026-03-15T23:59:59.999Z"),
  };

  it("renders the LOCKED title, formatted expiry date, and status footer", () => {
    const html = renderExpiredPage(baseCtx);
    expect(html).toContain("Dieser Link ist abgelaufen");
    expect(html).toContain(
      "Er war nur bis zum 15.03.2026 gültig und leitet nicht mehr weiter.",
    );
    expect(html).toContain("go.example.com/summer-sale");
    expect(html).toContain("HTTP 410 · Gone");
  });

  it("formats the expiry date as TT.MM.JJJJ using UTC (no local-timezone drift)", () => {
    const html = renderExpiredPage({
      ...baseCtx,
      expiresAt: new Date("2026-01-05T23:59:59.999Z"),
    });
    expect(html).toContain("05.01.2026");
  });

  it("escapes a script-injection payload in the slug", () => {
    const html = renderExpiredPage({ ...baseCtx, slug: SCRIPT_PAYLOAD });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("never contains a distinctive target-URL canary string (No-Leak)", () => {
    const html = renderExpiredPage({ ...baseCtx, target: LEAK_CANARY } as never);
    expect(html).not.toContain(LEAK_CANARY);
  });

  it("includes the prefers-color-scheme dark media block", () => {
    const html = renderExpiredPage(baseCtx);
    expect(html).toContain("prefers-color-scheme: dark");
  });
});

describe("renderNotFoundPage (D-11)", () => {
  const baseCtx = {
    brand: "Kurzly",
    accent: "#d7ff01",
    domain: "go.example.com",
    slug: "does-not-exist",
  };

  it("renders the LOCKED 404 display digit, title, body, CTA href, and status footer", () => {
    const html = renderNotFoundPage(baseCtx);
    expect(html).toContain(">404<");
    expect(html).toContain("Dieser Kurzlink existiert nicht");
    expect(html).toContain(
      "Der angeforderte Link wurde nicht gefunden, gelöscht oder falsch eingegeben.",
    );
    expect(html).toContain("go.example.com/does-not-exist");
    expect(html).toContain('href="https://go.example.com/"');
    expect(html).toContain("Zur Startseite →");
    expect(html).toContain("HTTP 404 · Not Found");
  });

  it("escapes a script-injection payload in the slug and domain (including the CTA href)", () => {
    const html = renderNotFoundPage({ ...baseCtx, slug: SCRIPT_PAYLOAD, domain: SCRIPT_PAYLOAD });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("never contains a distinctive target-URL canary string (No-Leak)", () => {
    const html = renderNotFoundPage({ ...baseCtx, target: LEAK_CANARY } as never);
    expect(html).not.toContain(LEAK_CANARY);
  });
});

describe("renderBotOgPage (REDIR-05, D-05/D-06)", () => {
  const baseCtx = {
    brand: "Kurzly",
    accent: "#d7ff01",
    domain: "go.example.com",
    slug: "promo",
  };

  it("carries generic brand og:title/og:description/og:image/og:url meta tags", () => {
    const html = renderBotOgPage(baseCtx);
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('property="og:url"');
    expect(html).toContain("Kurzly");
  });

  it("includes the noindex meta tag", () => {
    const html = renderBotOgPage(baseCtx);
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });

  it("escapes a script-injection payload in the slug/domain within the og:url meta tag", () => {
    const html = renderBotOgPage({ ...baseCtx, slug: SCRIPT_PAYLOAD, domain: SCRIPT_PAYLOAD });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("never contains a distinctive target-URL canary string (No-Leak, D-06)", () => {
    const html = renderBotOgPage({ ...baseCtx, target: LEAK_CANARY } as never);
    expect(html).not.toContain(LEAK_CANARY);
  });
});
