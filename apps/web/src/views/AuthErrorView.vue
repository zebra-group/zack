<script setup lang="ts">
/**
 * Generic magic-link error page (D-05, T-02-11). Renders ONE message for
 * expired / already-used / never-existent tokens — never differentiates,
 * so it cannot be used to enumerate accounts or probe link validity.
 *
 * Layout/copy is LOCKED per 02-UI-SPEC.md's "Magic-Link-Fehlerseite" block
 * (Design-Fidelity Waiver, UI-03).
 */
import { useRouter } from "vue-router";

const router = useRouter();

function requestNewLink(): void {
  router.push({ name: "login" });
}
</script>

<template>
  <div class="auth-wrapper">
    <div class="brand-row">
      <div class="logo-mark">K</div>
      <h1 class="brand-name">Kurzly</h1>
    </div>

    <div class="card">
      <div class="error-icon">⚠</div>
      <div class="title-group">
        <h2 class="card-title">Dieser Link ist ungültig oder abgelaufen</h2>
        <p class="card-body">
          Magic Links sind nur 15 Minuten gültig und können nur einmal verwendet werden.
          Fordere einfach einen neuen an.
        </p>
      </div>
      <button type="button" class="primary-button" @click="requestNewLink">
        Neuen Link anfordern
      </button>
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
  padding: 34px 26px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  text-align: center;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
  margin-top: 18px;
  margin-bottom: 18px;
}

.error-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--chip);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.title-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0;
  color: var(--text);
}

.card-body {
  font-size: 12.5px;
  color: var(--mut);
  margin: 0;
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

.primary-button:hover {
  opacity: 0.85;
}

.footer-text {
  font-size: 11px;
  color: var(--mut);
  text-align: center;
  margin: 0;
}
</style>
