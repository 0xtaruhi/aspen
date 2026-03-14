import { createApp } from 'vue'
import App from './App.vue'
import './index.css'
import { initThemeSync } from '@/lib/theme'
import router from '@/router'

initThemeSync()

createApp(App).use(router).mount('#app')
