import { createApp } from 'vue'
import App from './App.vue'
import './index.css'
import { initThemeSync } from '@/lib/theme'
import { applyPlatformThemeClass } from '@/lib/window-frame'
import { settingsStore } from '@/stores/settings'
import router from '@/router'

initThemeSync(settingsStore.state.themeMode)
applyPlatformThemeClass()

createApp(App).use(router).mount('#app')
