import { createApp } from 'vue'

import App from '@/App.vue'
import { initThemeSync } from '@/lib/theme'
import { applyPlatformThemeClass } from '@/lib/window-frame'
import router from '@/router'
import { settingsStore } from '@/stores/settings'

import './index.css'
import './styles/device-skins.css'

initThemeSync(settingsStore.state.themeMode)
applyPlatformThemeClass()

createApp(App).use(router).mount('#app')
