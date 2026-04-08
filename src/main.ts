import { createApp } from 'vue'
import App from './App.vue'
import './index.css'
import { initThemeSync } from '@/lib/theme'
import { settingsStore } from '@/stores/settings'
import router from '@/router'

initThemeSync(settingsStore.state.themeMode)

createApp(App).use(router).mount('#app')
