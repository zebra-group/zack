<script setup lang="ts">
/**
 * QR-Codes list + Studio screen (07-UI-SPEC.md Surface A, QR-02/03/04/07) —
 * replaces `ComingSoonView` at `/qr-codes` (router/index.ts, Task 1). This
 * is an intentionally minimal placeholder wired up by Task 1 so the router
 * swap type-checks; Task 2 replaces this body with the full four-state
 * list surface + list cards, and Task 3 layers on optimistic remap + the
 * remap-history expander.
 */
</script>

<template>
  <div class="screen-container">
    <h1>QR-Codes</h1>
  </div>
</template>

<style scoped>
.screen-container {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 36px 48px;
}
</style>
