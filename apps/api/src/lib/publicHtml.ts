/**
 * SINGLE shared, server-rendered public-HTML layer (D-09, RESEARCH Pattern
 * 6) — the password page (UI-04/REDIR-04), the expiry page
 * (UI-05/REDIR-03), the generic 404 page (D-11), and the bot-OG head
 * (REDIR-05/D-05/D-06) are all built here as pure, dependency-free tagged
 * template strings. No view-engine, no Vue/SPA, no Fastify import — this
 * module has zero side effects and is unit-testable without HTTP.
 *
 * SECURITY (Pitfall 1, T-05-XSS): every user-controlled interpolation
 * (above all the incoming URL `:slug` path segment, which is NEVER
 * shape-validated before reaching the 404 branch) MUST be routed through
 * `escapeHtml()` before it is placed into any of these template strings.
 * There is no automatic escaping the way a view-engine or Vue template
 * would give you — raw string interpolation into HTML is unescaped by
 * default.
 *
 * NO-LEAK (T-05-LEAK-HTML/T-05-OG-LEAK): none of the four render-context
 * types below carries a `target`/`targetUrl` field. This is a structural
 * guarantee, not a runtime check — a link's real destination simply cannot
 * be interpolated into any of these pages because it is never passed in.
 * Every page's "requested URL" chip shows only the *incoming* `domain`/
 * `slug` the visitor actually typed or scanned, never the link's target.
 */

/** Escapes the five HTML-significant characters. `&` MUST be replaced
 * first so it never re-escapes the entities produced by the later
 * replacements (e.g. escaping `<` before `&` would turn `&lt;` into
 * `&amp;lt;`). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formats a Date as `TT.MM.JJJJ` using UTC getters — the app's display
 * convention (see `apps/web/src/lib/format.ts`'s `formatDate`), computed
 * in UTC (not server-local time) to match `expiresAt`'s UTC end-of-day
 * persistence convention (05-02). */
function formatExpiryDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** Fields shared by every render context. `brand`/`accent` originate from
 * validated ENV (`BRAND_NAME`/`BRAND_ACCENT`, operator-controlled, not
 * attacker-controlled per-request input) — `domain`/`slug` originate from
 * the incoming request and are always escaped before interpolation. */
interface BasePageCtx {
  brand: string;
  accent: string;
  domain: string;
  slug: string;
}

export interface PasswordPageCtx extends BasePageCtx {
  errorState: boolean;
}

export interface ExpiredPageCtx extends BasePageCtx {
  expiresAt: Date;
}

export type NotFoundPageCtx = BasePageCtx;

/**
 * Extends `BasePageCtx` with three optional owner-authored fields
 * (META-02, D-08-03) — the link owner's custom social-preview title,
 * description, and image URL. Each is `string | null` text the owner
 * typed into this link's own OG builder; none of them can carry the
 * destination, so this file's NO-LEAK contract (see the module header) is
 * unaffected — `renderBotOgPage` still never receives a `target`/
 * `targetUrl` field. Fields left `null`/unset keep the existing generic
 * brand fallback.
 */
export interface BotOgPageCtx extends BasePageCtx {
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
}

/** The full inline `<style>` body — tokens copied 1:1 from
 * `apps/web/src/styles/tokens.css` / 05-UI-SPEC.md's Color section, since
 * these standalone documents have no access to the SPA's CSS bundle.
 * `accent` is operator-configured (`BRAND_ACCENT`, ENV, not part of the
 * incoming-request trust boundary) and is inserted as a raw CSS custom
 * property value — entity-escaping it would corrupt a hex color/CSS
 * value, so it is intentionally NOT passed through escapeHtml here. */
function documentStyle(accent: string): string {
  return `
    :root, body {
      --bg: #f7f7f5; --panel: #ffffff; --border: #e6e6e2; --text: #1b1b18;
      --mut: #8b8b84; --hover: #f0f0ec; --chip: #f1f1ed;
      --accent: ${accent}; --ok: #3a9e5f;
      color-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
      :root, body {
        --bg: #121211; --panel: #1a1a19; --border: #2b2b29; --text: #f1f1ec;
        --mut: #8f8f87; --hover: #232321; --chip: #242422;
        --accent: ${accent}; --ok: #5fc98a;
        color-scheme: dark;
      }
    }
    body { font-family: 'Geist', system-ui, sans-serif; margin: 0; color: var(--text); background: var(--bg); }

    .wrapper { position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; padding:24px }
    .column { max-width:100%; display:flex; flex-direction:column; gap:18px }
    .brand-row { display:flex; align-items:center; gap:6px; justify-content:center }
    .logo-mark { width:30px; height:30px; border-radius:8px; background:var(--accent); display:flex; align-items:center; justify-content:center; color:#1b1b18; font-weight:700; font-size:16px }
    .brand-name { font-size:19px; font-weight:600; letter-spacing:-.01em }
    .footer-text { font-size:11px; color:var(--mut); text-align:center }

    .card { background:var(--panel); border:1px solid var(--border); border-radius:16px; padding:30px 26px; display:flex; flex-direction:column; gap:16px; align-items:center; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,.12) }
    .icon-tile { width:52px; height:52px; border-radius:14px; background:var(--chip); display:flex; align-items:center; justify-content:center; font-size:24px }
    .title { font-size:17px; font-weight:600; margin:0 }
    .body { font-size:12.5px; color:var(--mut); margin:0 }
    .url-chip { font-size:11.5px; color:var(--mut); font-family:'Geist Mono',monospace; background:var(--chip); border-radius:7px; padding:6px 11px }
    .inline-error { font-size:11.5px; color:#e5484d }
    .password-form { display:flex; flex-direction:column; gap:9px; width:100% }
    .primary-cta { padding:11px 0; border:none; border-radius:9px; background:var(--accent); color:#1b1b18; font-size:13.5px; font-weight:600; width:100%; cursor:pointer; text-decoration:none; display:inline-block; box-sizing:border-box }
    .cta-404 { padding:10px 18px; width:auto; font-size:13px }
    .status-footer { font-size:11px; color:var(--mut); border-top:1px solid var(--border); padding-top:14px; width:100% }
    .display-digit { font-size:52px; font-weight:700; font-family:'Geist Mono',monospace; letter-spacing:-.03em; line-height:1; margin:0 }
  `;
}

/** Shared document shell (`<!doctype html>` … `<body><div class="wrapper">…`)
 * used by the password/expiry/404 pages. `pageTitle`/`brand` are escaped —
 * `brand` is ENV-controlled, not attacker-controlled, but escaping it here
 * is free and keeps the interpolation discipline uniform. */
function renderDocumentShell(opts: { pageTitle: string; brand: string; accent: string; bodyHtml: string }): string {
  const safeTitle = escapeHtml(opts.pageTitle);
  const safeBrand = escapeHtml(opts.brand);
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} · ${safeBrand}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>${documentStyle(opts.accent)}</style>
  <meta name="robots" content="noindex" />
</head>
<body>
  <div class="wrapper">${opts.bodyHtml}</div>
</body>
</html>`;
}

/** Brand row (logo tile + name), identical shape on all three visitor
 * pages (05-UI-SPEC.md's "Bewusste Abweichungen" table — unified across
 * password/expiry/404, pattern-derived from `LoginView.vue`/`AuthErrorView.vue`).
 * `brandInitial` = first character of `brand`, uppercased (prototype
 * formula, `brand.slice(0,1).toUpperCase()`). */
function renderBrandRow(brand: string): string {
  const safeBrand = escapeHtml(brand);
  const initial = escapeHtml(brand.slice(0, 1).toUpperCase());
  return `<div class="brand-row"><div class="logo-mark">${initial}</div><div class="brand-name">${safeBrand}</div></div>`;
}

function renderFooter(brand: string): string {
  return `<div class="footer-text">${escapeHtml(brand)} · self-hosted</div>`;
}

/**
 * Password page (UI-04, REDIR-04). GET response for a password-protected
 * slug — HTTP 200, the page loads successfully, only the target stays
 * hidden. `errorState=true` re-renders the same page with the LOCKED
 * inline error + destructive input border (wrong password), still never
 * revealing the target. The form's native POST needs no client JS.
 */
export function renderPasswordPage(ctx: PasswordPageCtx): string {
  const safeDomain = escapeHtml(ctx.domain);
  const safeSlug = escapeHtml(ctx.slug);
  const borderColor = ctx.errorState ? "#e5484d" : "var(--border)";
  const errorBlock = ctx.errorState
    ? `<div class="inline-error">Falsches Passwort. Bitte erneut versuchen.</div>`
    : "";

  const bodyHtml = `
    <div class="column" style="width:380px">
      ${renderBrandRow(ctx.brand)}
      <div class="card">
        <div class="icon-tile">🔒</div>
        <div class="title">Dieser Link ist geschützt</div>
        <div class="body">Gib das Passwort ein, um zum Ziel weitergeleitet zu werden.</div>
        <div class="url-chip">${safeDomain}/${safeSlug}</div>
        <form method="POST" action="/${safeSlug}/verify" class="password-form">
          <input type="password" name="password" placeholder="Passwort" autofocus
                 style="padding:11px 13px; border:1px solid ${borderColor}; border-radius:9px; background:var(--bg); color:var(--text); font-size:13.5px; text-align:center; width:100%; box-sizing:border-box" />
          ${errorBlock}
          <button type="submit" class="primary-cta">Weiter →</button>
        </form>
      </div>
      ${renderFooter(ctx.brand)}
    </div>
  `;

  return renderDocumentShell({
    pageTitle: "Dieser Link ist geschützt",
    brand: ctx.brand,
    accent: ctx.accent,
    bodyHtml,
  });
}

/**
 * Expiry page (UI-05, REDIR-03). Never a redirect — a pure HTML body the
 * caller sends with HTTP 410 (this function only builds the body/markup;
 * the status code is the route layer's responsibility, D-14 precedence:
 * expiry beats the password gate).
 */
export function renderExpiredPage(ctx: ExpiredPageCtx): string {
  const safeDomain = escapeHtml(ctx.domain);
  const safeSlug = escapeHtml(ctx.slug);
  const expDate = formatExpiryDate(ctx.expiresAt);

  const bodyHtml = `
    <div class="column" style="width:380px">
      ${renderBrandRow(ctx.brand)}
      <div class="card" style="padding:34px 26px">
        <div class="icon-tile">⏱</div>
        <div class="title">Dieser Link ist abgelaufen</div>
        <div class="body">Er war nur bis zum ${expDate} gültig und leitet nicht mehr weiter.</div>
        <div class="url-chip">${safeDomain}/${safeSlug}</div>
        <div class="status-footer">HTTP 410 · Gone</div>
      </div>
      ${renderFooter(ctx.brand)}
    </div>
  `;

  return renderDocumentShell({
    pageTitle: "Dieser Link ist abgelaufen",
    brand: ctx.brand,
    accent: ctx.accent,
    bodyHtml,
  });
}

/**
 * Generic 404 page (D-11). Identical copy for "slug never existed",
 * "slug was deleted", and "host resolves but no link here" — no visual,
 * textual, or timing distinction between these cases is made here (the
 * route layer's job to ensure it never differs either).
 */
export function renderNotFoundPage(ctx: NotFoundPageCtx): string {
  const safeDomain = escapeHtml(ctx.domain);
  const safeSlug = escapeHtml(ctx.slug);

  const bodyHtml = `
    <div class="column" style="width:400px">
      ${renderBrandRow(ctx.brand)}
      <div class="card" style="padding:34px 26px">
        <div class="display-digit">404</div>
        <div class="title">Dieser Kurzlink existiert nicht</div>
        <div class="body">Der angeforderte Link wurde nicht gefunden, gelöscht oder falsch eingegeben.</div>
        <div class="url-chip">${safeDomain}/${safeSlug}</div>
        <a class="primary-cta cta-404" href="https://${safeDomain}/">Zur Startseite →</a>
        <div class="status-footer">HTTP 404 · Not Found</div>
      </div>
      ${renderFooter(ctx.brand)}
    </div>
  `;

  return renderDocumentShell({
    pageTitle: "Dieser Kurzlink existiert nicht",
    brand: ctx.brand,
    accent: ctx.accent,
    bodyHtml,
  });
}

/**
 * Bot/crawler OG-HTML path (REDIR-05, D-05/D-06) — structural, not a
 * visually-designed fourth screen. Detected bots ALWAYS get this generic,
 * brand-only 200 response, even for protected/expired links — never the
 * human error-state pages, and never a redirect to the real target
 * (D-06). `<body>` stays minimal; crawlers read primarily `<head>`.
 */
export function renderBotOgPage(ctx: BotOgPageCtx): string {
  const safeBrand = escapeHtml(ctx.brand);
  const safeDomain = escapeHtml(ctx.domain);
  const safeSlug = escapeHtml(ctx.slug);
  // The requested short URL (never the link's target) — same No-Leak
  // contract as the visitor pages' url-chip.
  const ogUrl = `https://${safeDomain}/${safeSlug}`;

  // Per-field resolution against the existing generic fallbacks (D-08-03):
  // a custom value is used only when it is a non-empty string; blank/null
  // keeps today's brand-only copy so links without custom metadata render
  // byte-identically to before this change.
  const resolvedTitle = isSetOgValue(ctx.ogTitle) ? ctx.ogTitle : ctx.brand;
  const resolvedDescription = isSetOgValue(ctx.ogDescription)
    ? ctx.ogDescription
    : `${ctx.brand} · self-hosted URL shortener`;
  const fallbackImageUrl = `https://${ctx.domain}/favicon.ico`;
  const resolvedImageUrl = isAbsoluteHttpUrl(ctx.ogImageUrl) ? ctx.ogImageUrl : fallbackImageUrl;

  const safeTitle = escapeHtml(resolvedTitle);
  const safeDescription = escapeHtml(resolvedDescription);
  const safeImageUrl = escapeHtml(resolvedImageUrl);

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:image" content="${safeImageUrl}" />
  <meta property="og:url" content="${ogUrl}" />
  <meta name="robots" content="noindex" />
</head>
<body></body>
</html>`;
}

/** An owner-typed OG value counts as "set" only when it is a non-empty,
 * non-whitespace-only string — `null`/undefined/blank fall back to the
 * generic brand copy. */
function isSetOgValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Render-time guard (defence in depth over plan 08-01's write-time
 * validation, T-08-OGIMG-SCHEME): only an absolute `http:`/`https:` URL is
 * accepted for `og:image`. A value that predates validation, or that a
 * future code path introduces without going through `lib/links.ts`'s
 * write-time check, can therefore never reach the rendered attribute. The
 * server never fetches this URL anywhere (D-08-04) — it is emitted as a
 * plain attribute value only.
 */
function isAbsoluteHttpUrl(value: string | null | undefined): value is string {
  if (!isSetOgValue(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
