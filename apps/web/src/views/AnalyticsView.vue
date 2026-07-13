<script setup lang="ts">
/**
 * Global analytics overview (06-UI-SPEC.md § Surface B, TRACK-05) — route
 * /analytics, replaces the Phase-4 `ComingSoonView` placeholder. Loads the
 * account-wide `GlobalAnalyticsDTO` (scoped server-side to the caller's own
 * domains, `scopedDomainIds`) on mount and renders exactly one of three
 * mutually-exclusive states: loading skeleton, zero-data, or data — the
 * exact same 3-state pattern and locked tokens as Surface A
 * (LinkDetailView.vue), 06-07.
 *
 * QR-Scans (D-14): a normal metric read straight from the DTO's `qrScans`
 * field — always 0 this phase, no special "coming soon" copy, so Phase 7
 * just starts writing `source='qr'` rows and the tile lights up on its own.
 *
 * Aktive Links: independent of click volume — reads `activeLinks` directly,
 * NEVER zero-forced in the zero-data branch (a link owner can have active
 * links with zero clicks).
 *
 * Toast pattern: per-view ref + setTimeout (04-PATTERNS.md), no global
 * store — matches LinkDetailView.vue/LinksView.vue.
 */
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { GlobalAnalyticsDTO } from "@kurzly/shared";
import { getGlobalAnalytics } from "../api";

const router = useRouter();

const analytics = ref<GlobalAnalyticsDTO | null>(null);
const loading = ref(true);

const toastMessage = ref<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMessage.value = message;
  toastTimeout = setTimeout(() => {
    toastMessage.value = null;
  }, 1700);
}

// Gates the zero-data/data branch — sourced from clicks30Days (never a live
// re-derivation), matching Surface A's totalClicks gate.
const clicks30Days = computed(() => analytics.value?.clicks30Days ?? 0);

/**
 * 30-bar chart data (06-UI-SPEC.md: `.bar { height:{{pct}}%; min-height:3px }`).
 * `pct` is scaled against the series' own max count; the CSS `min-height:3px`
 * (not this computed) provides the visual floor for zero/near-zero days.
 */
const chartBars = computed(() => {
  const series = analytics.value?.dailySeries ?? [];
  const max = series.reduce((m, d) => Math.max(m, d.count), 0);
  return series.map((d) => ({
    day: d.day,
    count: d.count,
    pct: max > 0 ? (d.count / max) * 100 : 0,
  }));
});

/** Shared row-shape builder for Top-Links/Referrer `.list-row`s (row-bar-fill scaled to each list's own max). */
function toListRows<T>(
  entries: T[],
  nameOf: (entry: T) => string,
  countOf: (entry: T) => number,
  idOf?: (entry: T) => string,
): { name: string; count: number; pct: number; id?: string }[] {
  const max = entries.reduce((m, e) => Math.max(m, countOf(e)), 0);
  return entries.map((e) => ({
    name: nameOf(e),
    count: countOf(e),
    pct: max > 0 ? (countOf(e) / max) * 100 : 0,
    id: idOf?.(e),
  }));
}

const topLinksRows = computed(() =>
  toListRows(
    analytics.value?.topLinks ?? [],
    (l) => `/${l.slug}`,
    (l) => l.clicks,
    (l) => l.id,
  ),
);
// D-07: a null referrer host means a direct visit — labeled "Direkt" here,
// not in the DTO (raw data stays locale-neutral, RESEARCH Anti-Patterns).
const referrerRows = computed(() =>
  toListRows(
    analytics.value?.topReferrers ?? [],
    (r) => r.host ?? "Direkt",
    (r) => r.count,
  ),
);

function goToLink(id: string | undefined): void {
  if (!id) return;
  router.push({ name: "link-detail", params: { id } });
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    analytics.value = await getGlobalAnalytics();
  } catch {
    showToast("Analytics konnten nicht geladen werden.");
  } finally {
    loading.value = false;
  }
}

load();
</script>

<template>
  <div class="screen-container">
    <div class="screen-header">
      <div class="header-title">Analytics</div>
      <div class="header-subtitle">alle Links · letzte 30 Tage</div>
    </div>

    <!-- Exactly one of three mutually-exclusive states. -->
    <template v-if="loading">
      <div class="stat-grid">
        <div v-for="n in 4" :key="n" class="stat-card">
          <div class="skeleton-block skeleton-stat-label"></div>
          <div class="skeleton-block skeleton-stat-value"></div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Klicks gesamt</div>
        <div class="skeleton-block skeleton-chart"></div>
      </div>
      <div class="two-col">
        <div class="list-card">
          <div class="list-title">Top Links</div>
          <div v-for="n in 5" :key="n" class="list-row skeleton-list-row">
            <div class="skeleton-block skeleton-row-name-wide"></div>
            <div class="skeleton-block skeleton-row-bar"></div>
            <div class="skeleton-block skeleton-row-pct"></div>
          </div>
        </div>
        <div class="list-card">
          <div class="list-title">Referrer</div>
          <div v-for="n in 5" :key="n" class="list-row skeleton-list-row">
            <div class="skeleton-block skeleton-row-name"></div>
            <div class="skeleton-block skeleton-row-bar"></div>
            <div class="skeleton-block skeleton-row-pct"></div>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="clicks30Days === 0">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Klicks (30 Tage)</div>
          <div class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Unique Visitors</div>
          <div class="stat-value">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Aktive Links</div>
          <div class="stat-value">{{ analytics?.activeLinks ?? 0 }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">QR-Scans</div>
          <div class="stat-value">{{ analytics?.qrScans ?? 0 }}</div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Klicks gesamt</div>
        <div class="zero-data-hint">
          Noch keine Klicks erfasst — sobald Links aufgerufen werden, erscheinen hier Daten.
        </div>
      </div>
      <div class="two-col">
        <div class="list-card">
          <div class="list-title">Top Links</div>
          <div class="list-empty-row">Keine Daten</div>
        </div>
        <div class="list-card">
          <div class="list-title">Referrer</div>
          <div class="list-empty-row">Keine Daten</div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Klicks (30 Tage)</div>
          <div class="stat-value">{{ clicks30Days }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Unique Visitors</div>
          <div class="stat-value">{{ analytics?.uniqueVisitors ?? 0 }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Aktive Links</div>
          <div class="stat-value">{{ analytics?.activeLinks ?? 0 }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">QR-Scans</div>
          <div class="stat-value">{{ analytics?.qrScans ?? 0 }}</div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Klicks gesamt</div>
        <div class="chart-bars">
          <div
            v-for="bar in chartBars"
            :key="bar.day"
            class="bar"
            :style="{ height: bar.pct + '%' }"
            :title="`${bar.day}: ${bar.count} Klicks`"
          ></div>
        </div>
      </div>
      <div class="two-col">
        <div class="list-card">
          <div class="list-title">Top Links</div>
          <div
            v-for="row in topLinksRows"
            :key="row.id ?? row.name"
            class="list-row top-links-row"
            @click="goToLink(row.id)"
          >
            <div class="row-name row-name-wide">{{ row.name }}</div>
            <div class="row-bar-track">
              <div class="row-bar-fill" :style="{ width: row.pct + '%' }"></div>
            </div>
            <div class="row-count">{{ row.count }}</div>
          </div>
        </div>
        <div class="list-card">
          <div class="list-title">Referrer</div>
          <div v-for="row in referrerRows" :key="row.name" class="list-row">
            <div class="row-name">{{ row.name }}</div>
            <div class="row-bar-track">
              <div class="row-bar-fill" :style="{ width: row.pct + '%' }"></div>
            </div>
            <div class="row-pct">{{ Math.round(row.pct) }}%</div>
          </div>
        </div>
      </div>
    </template>
  </div>

  <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
</template>

<style scoped>
/* Screen container (06-UI-SPEC.md § Surface B — gap:16px, an exception to
   the 18px standard used by other screens like LinkDetailView.vue). */
.screen-container {
  max-width: 1060px;
  margin: 0 auto;
  padding: 28px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.screen-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.header-title {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.header-subtitle {
  font-size: 12.5px;
  color: var(--mut);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 11.5px;
  color: var(--mut);
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  font-family: "Geist Mono", monospace;
}

.chart-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chart-title {
  font-size: 12.5px;
  color: var(--mut);
}

.chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 150px;
}

.bar {
  flex: 1;
  background: var(--chip);
  border-radius: 3px 3px 0 0;
  min-height: 3px;
}

.bar:hover {
  background: var(--accent);
}

.zero-data-hint {
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12.5px;
  color: var(--mut);
  padding: 0 24px;
}

.two-col {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 12px;
}

.list-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list-title {
  font-size: 12.5px;
  color: var(--mut);
}

.list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}

.top-links-row {
  cursor: pointer;
  border-radius: 6px;
  padding: 3px 4px;
  margin: -3px -4px;
}

.top-links-row:hover {
  background: var(--hover);
}

.row-name {
  width: 90px;
  flex: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-name-wide {
  width: 190px;
  font-family: "Geist Mono", monospace;
}

.row-bar-track {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--chip);
  overflow: hidden;
}

.row-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
}

.row-pct {
  width: 38px;
  text-align: right;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
  font-size: 11.5px;
}

.row-count {
  width: 48px;
  text-align: right;
  font-family: "Geist Mono", monospace;
  color: var(--mut);
  font-size: 11.5px;
}

.list-empty-row {
  padding: 12px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--mut);
}

/* Loading skeleton (06-UI-SPEC.md § Loading State) — identical card shells
   to the Data State, grey placeholder blocks instead of content, no
   spinner. */
.skeleton-block {
  background: var(--chip);
  border-radius: 4px;
}

.skeleton-stat-label {
  width: 60%;
  height: 11px;
}

.skeleton-stat-value {
  width: 50%;
  height: 18px;
  margin-top: 4px;
}

.skeleton-chart {
  width: 100%;
  height: 150px;
}

.skeleton-list-row {
  gap: 10px;
}

.skeleton-row-name {
  width: 90px;
  height: 12px;
}

.skeleton-row-name-wide {
  width: 190px;
  height: 12px;
}

.skeleton-row-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
}

.skeleton-row-pct {
  width: 38px;
  height: 12px;
}

/* Toast (global pattern, reused). */
.toast {
  position: fixed;
  bottom: 26px;
  left: 50%;
  transform: translateX(-50%);
  background: #1b1b18;
  color: #f1f1ec;
  font-size: 12.5px;
  padding: 9px 16px;
  border-radius: 999px;
  z-index: 100;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  font-family: "Geist Mono", monospace;
}
</style>
