<script setup lang="ts">
/**
 * Reusable placeholder for nav destinations not yet built (Links,
 * QR-Codes, Analytics, Domains, Team). The screen title + card heading
 * read the route's `meta.label` (set per-route in router/index.ts).
 */
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const label = computed(() => (route.meta.label as string | undefined) ?? "");
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <h1>{{ label }}</h1>
    </div>

    <div class="coming-soon-card">
      <h3 class="card-heading">{{ label }} — bald verfügbar</h3>
      <p class="card-body">
        Dieser Bereich ist noch nicht freigeschaltet. Er kommt in einer der nächsten Phasen.
      </p>
    </div>
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

.coming-soon-card {
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  background: var(--panel);
}

.card-heading {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.card-body {
  font-size: 12.5px;
  color: var(--mut);
  margin: 4px 0 0;
}
</style>
