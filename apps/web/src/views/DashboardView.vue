<script setup lang="ts">
/**
 * Post-login landing (D-03: "Landing nach Login = Dashboard/Übersicht").
 * Warm welcome copy per UI-SPEC Copywriting Contract — deliberately not a
 * dashed empty-state (this is a real landing experience, not "missing").
 */
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>Übersicht</h1>
    </div>
    <p class="welcome-body">
      Willkommen bei Kurzly. Deine Übersicht füllt sich, sobald du Links, Domains und QR-Codes
      anlegst.
    </p>
  </div>
</template>

<style scoped>
.screen-container {
  max-width: 1060px;
  margin: 0 auto;
  padding: 28px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.screen-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.screen-header h1 {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

.welcome-body {
  font-size: 13.5px;
  color: var(--text);
  margin: 0;
}
</style>
