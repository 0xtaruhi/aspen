<template>
  <button
    class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-9 w-9"
    @click="handleToggle"
    :title="t('themeToggle')"
  >
    <component :is="iconComponent" class="h-4 w-4" />
    <span class="sr-only">{{ t('themeToggle') }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Moon, Sun } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { toggleTheme, useThemeState } from '@/lib/theme'

const themeState = useThemeState()
const { t } = useI18n()

const isDark = computed(() => themeState.value)
const iconComponent = computed(() => (isDark.value ? Moon : Sun))

function handleToggle() {
  toggleTheme()
}
</script>
