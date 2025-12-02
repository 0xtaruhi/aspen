import { createApp } from "vue";
import App from "./App.vue";
import "./index.css";
import { initThemeSync } from "@/lib/theme";

initThemeSync();

createApp(App).mount("#app");
