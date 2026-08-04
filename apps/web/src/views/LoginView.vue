<script setup lang="ts">
/**
 * Magic-link login (AUTH-01 UI). Two states: Idle (email + CTA) → Sent
 * (neutral confirmation copy — identical regardless of allowlist status,
 * D-01/T-02-12, proven server-side by 02-04's neutral-response canary).
 *
 * Layout/copy is LOCKED per 02-UI-SPEC.md's "Login-Seite & Fehlerseite —
 * Layout Contract" — do not consolidate spacing/typography (Design-Fidelity
 * Waiver, UI-03).
 */
import { onMounted, ref } from "vue";
import { getSsoStatus } from "../api";

type LoginState = "idle" | "sent";

const email = ref("");
const state = ref<LoginState>("idle");
const error = ref<string | null>(null);
const loading = ref(false);

// AUTH-06 / 10-UI-SPEC Surface B (UI-10-07..10): conditional "Mit SSO
// anmelden" secondary action. Fail-closed by design (T-10-FAILOPEN) — stays
// false unless the status fetch succeeds AND explicitly reports
// enabled: true. No error is ever shown for a failed status read; magic-link
// remains the only visible path.
const ssoEnabled = ref(false);

// The fixed genericOAuth provider id registered server-side
// (apps/api/src/lib/ssoConfig.ts SSO_PROVIDER_ID) — both sides must always
// agree so the sign-in call resolves to the configured provider.
const SSO_PROVIDER_ID = "oidc";

async function loadSsoStatus(): Promise<void> {
  try {
    // IN-02: route through the typed `getSsoStatus()` client (same one
    // TeamView uses) rather than a hand-rolled fetch + untyped `.json()`, so
    // the endpoint URL and the SsoStatusDTO shape have a single consumer
    // contract. A non-ok response throws `ApiError` — caught below and
    // treated as fail-closed, exactly as before (UI-10-08).
    const status = await getSsoStatus();
    ssoEnabled.value = status.enabled === true;
  } catch {
    // fail-closed (UI-10-08): leave ssoEnabled false, show no error.
  }
}

onMounted(() => {
  void loadSsoStatus();
});

async function signInWithSso(): Promise<void> {
  try {
    const response = await fetch("/api/auth/sign-in/oauth2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // WR-02 fix (mirrors the magic-link CR-02 fix below): without
      // `errorCallbackURL`, better-auth routes a FAILED OAuth callback (IdP
      // denies, state mismatch, discovery/token error) back to `callbackURL`
      // ("/"), where the router guard silently bounces to /login and the
      // dedicated no-leak /auth/error screen is never reached. Sending both
      // routes a failed sign-in to the visible error page.
      body: JSON.stringify({
        providerId: SSO_PROVIDER_ID,
        callbackURL: "/",
        errorCallbackURL: "/auth/error",
      }),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (typeof data?.url === "string") {
      window.location.assign(data.url);
    }
  } catch {
    // No dead-click placeholder — a failed sign-in initiation simply leaves
    // the user on the login screen where they can retry or use magic-link.
  }
}

async function sendMagicLink(): Promise<void> {
  error.value = null;
  loading.value = true;
  try {
    const response = await fetch("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // CR-02 fix (D-05): without `errorCallbackURL`, better-auth's verify
      // endpoint falls back to `callbackURL` (itself defaulting to "/") for
      // BOTH success and failure — so a failed verification 302-redirects
      // to "/", the router guard then silently bounces to /login with no
      // error explanation, and the dedicated /auth/error screen is never
      // reached. Supplying both explicitly routes failed verification to
      // the generic, no-leak error page (D-05) and successful verification
      // to the dashboard.
      body: JSON.stringify({
        email: email.value,
        callbackURL: "/",
        errorCallbackURL: "/auth/error",
      }),
    });

    if (response.status === 429) {
      error.value = "Zu viele Anfragen. Bitte warte kurz, bevor du es erneut versuchst.";
      return;
    }
    if (!response.ok) {
      error.value = "Der Magic Link konnte nicht gesendet werden. Bitte versuche es erneut.";
      return;
    }

    state.value = "sent";
  } catch {
    error.value = "Der Magic Link konnte nicht gesendet werden. Bitte versuche es erneut.";
  } finally {
    loading.value = false;
  }
}

function useAnotherEmail(): void {
  state.value = "idle";
  error.value = null;
}
</script>

<template>
  <div class="auth-wrapper">
    <div class="brand-row">
      <div class="logo-mark">K</div>
      <h1 class="brand-name">Zack</h1>
    </div>

    <div class="card">
      <template v-if="state === 'idle'">
        <div class="title-group">
          <h2 class="card-title">Anmelden</h2>
          <p class="card-body">
            Wir senden dir einen Magic Link an deine E-Mail — kein Passwort nötig.
          </p>
        </div>
        <input
          v-model="email"
          type="email"
          placeholder="du@firma.de"
          class="auth-input"
          @keydown.enter="sendMagicLink"
        />
        <button
          type="button"
          class="primary-button"
          :disabled="loading"
          @click="sendMagicLink"
        >
          Magic Link senden
        </button>
        <p v-if="error" class="error-inline">{{ error }}</p>
        <template v-if="ssoEnabled">
          <div class="divider">
            <div class="divider-line"></div>
            <span>oder</span>
            <div class="divider-line"></div>
          </div>
          <button type="button" class="sso-button" @click="signInWithSso">
            <span class="sso-dot" aria-hidden="true"></span>
            Mit SSO anmelden
          </button>
        </template>
      </template>

      <template v-else>
        <div class="sent-state">
          <div class="sent-icon">✉</div>
          <h2 class="card-title sent-title">Link gesendet</h2>
          <p class="card-body">
            Prüfe <span class="email-highlight">{{ email }}</span> — der Link ist 15
            Minuten gültig.
          </p>
          <a href="#" class="back-link" @click.prevent="useAnotherEmail">
            ← andere E-Mail verwenden
          </a>
        </div>
      </template>
    </div>

    <p class="footer-text">Auth via better-auth · self-hosted</p>
  </div>
</template>

<style scoped>
.auth-wrapper {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
}

.logo-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1b1b18;
  font-weight: 700;
  font-size: 16px;
}

.brand-name {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}

/*
 * The 360px card width is LOCKED per the UI-SPEC (Auth-Card-Breite,
 * Immutable Spacing-/Dimensions-Tokens table). The wrapper stacks the brand
 * row, card, and footer with an 18px gap, and the wrapper itself has no
 * fixed width beyond the 360px card's own max-width — set here so the
 * whole column (brand + card + footer) shares the same 360px column.
 */
.auth-wrapper > .brand-row,
.auth-wrapper > .footer-text {
  width: 360px;
  max-width: 100%;
}

.card {
  width: 360px;
  max-width: 100%;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 26px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
  margin-top: 18px;
  margin-bottom: 18px;
}

.title-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text);
}

.card-body {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
}

.auth-input {
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg);
  color: var(--text);
  font-size: 13.5px;
  outline: none;
  font-family: "Geist Mono", monospace;
}

.auth-input:focus {
  border-color: var(--text);
}

.primary-button {
  padding: 11px 0;
  border: none;
  border-radius: 9px;
  background: var(--accent);
  color: #1b1b18;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
}

.primary-button:hover:not(:disabled) {
  opacity: 0.85;
}

.primary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-inline {
  font-size: 11.5px;
  color: #e5484d;
  margin: -6px 0 0;
}

/*
 * AUTH-06 / 10-UI-SPEC Surface B (UI-10-07..10) — LOCKED prototype values
 * (Z.478-480). Do not round/consolidate (Design-Fidelity Waiver, UI-03).
 */
.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--mut);
  font-size: 11px;
}

.divider-line {
  flex: 1;
  height: 1px;
  background: var(--border);
}

.sso-button {
  padding: 11px 0;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  width: 100%;
}

.sso-button:hover {
  background: var(--hover);
}

/* Decorative only (aria-hidden) — the "Aktiv" meaning is carried by the
   button's text label, not by color alone (T-10-COLOR-ONLY). */
.sso-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ok);
}

.sent-state {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  text-align: center;
  padding: 8px 0;
}

.sent-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #1b1b18;
}

.sent-title {
  font-size: 15px;
}

.email-highlight {
  font-family: "Geist Mono", monospace;
  color: var(--text);
}

.back-link {
  font-size: 12px;
  color: var(--mut);
  text-decoration: none;
  cursor: pointer;
  margin-top: 2px;
}

.back-link:hover {
  color: var(--text);
}

.footer-text {
  font-size: 11px;
  color: var(--mut);
  text-align: center;
  margin: 0;
}
</style>
