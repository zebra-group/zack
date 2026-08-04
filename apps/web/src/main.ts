import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "./styles/tokens.css";

// Pre-paint theme application (UI-02/UI-03): read the persisted theme
// BEFORE createApp().mount() so there is no flash of the wrong theme. The
// theme Pinia store (stores/theme.ts) re-applies + keeps this in sync once
// it's instantiated, but this synchronous read/write must happen first.
const storedTheme = localStorage.getItem("zack-theme");
document.body.dataset.theme = storedTheme === "dark" ? "dark" : "";

const app = createApp(App);
app.use(createPinia());
app.use(router);

// Wait for the router's initial navigation (and its beforeEach auth guard)
// to resolve before mounting, so App.vue never renders a protected route
// for an unauthenticated user, even for one tick.
router.isReady().then(() => {
  app.mount("#app");
});
