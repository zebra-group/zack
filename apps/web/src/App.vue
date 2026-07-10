<script setup lang="ts">
// Walking skeleton dashboard (plan 01-07): the one real, interactive
// browser -> API -> Postgres round-trip. Intentionally minimal — NOT the
// Hi-Fi dashboard (Phase 2's UI slice replaces this).
import { onMounted, ref } from "vue";
import { createCanary, getCanary } from "./api";

const total = ref<number | null>(null);
const latest = ref<string | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

async function loadCanary(): Promise<void> {
  error.value = null;
  try {
    const status = await getCanary();
    total.value = status.total;
    latest.value = status.latest;
  } catch {
    error.value = "Failed to load canary status.";
  }
}

async function writeCanary(): Promise<void> {
  error.value = null;
  loading.value = true;
  try {
    const result = await createCanary();
    total.value = result.total;
    latest.value = result.token;
  } catch {
    error.value = "Failed to write canary.";
  } finally {
    loading.value = false;
  }
}

onMounted(loadCanary);
</script>

<template>
  <main>
    <h1>Kurzly</h1>
    <p>Scaffold placeholder — dashboard UI arrives in a later phase.</p>

    <section>
      <h2>Persistence canary</h2>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-else>Total: {{ total ?? "…" }}</p>
      <p v-if="latest">Latest token: {{ latest }}</p>
      <button type="button" :disabled="loading" @click="writeCanary">Write canary</button>
    </section>
  </main>
</template>
