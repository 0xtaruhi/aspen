<script setup lang="ts">
import { computed } from 'vue'
import { Globe, MonitorCog, ShieldCheck } from 'lucide-vue-next'

import ThemeToggleButton from '@/components/ThemeToggleButton.vue'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/lib/i18n'
import {
  APP_THEME_PRESET_COLORS,
  normalizeThemeAccentColor,
  type AppThemePresetColor,
} from '@/lib/theme-accent'
import { settingsStore, type AppLanguage } from '@/stores/settings'

const { t } = useI18n()

const fontSizeValue = computed(() => String(settingsStore.state.editorFontSize))
const themeAccentInput = computed(() => normalizeThemeAccentColor(settingsStore.state.themeAccent))
const themePresetOptions = Object.keys(APP_THEME_PRESET_COLORS) as AppThemePresetColor[]

function handleLanguageChange(value: unknown) {
  if (value === 'en-US' || value === 'zh-CN') {
    settingsStore.setLanguage(value as AppLanguage)
  }
}

function handleFontSizeChange(value: unknown) {
  const nextValue = Number(value)
  if (!Number.isNaN(nextValue)) {
    settingsStore.setEditorFontSize(nextValue)
  }
}

function applyThemeAccentPreset(color: AppThemePresetColor) {
  settingsStore.setThemeAccent(APP_THEME_PRESET_COLORS[color])
}

function handleThemeAccentInput(value: string) {
  settingsStore.setThemeAccent(value)
}
</script>

<template>
  <div class="h-full overflow-auto bg-background">
    <div class="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="space-y-2">
          <Badge variant="outline">{{ t('settings') }}</Badge>
          <div>
            <h1 class="text-3xl font-semibold tracking-tight">{{ t('settings') }}</h1>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ t('settingsDescription') }}
            </p>
          </div>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div class="grid gap-6">
          <Card class="border-border/70 shadow-sm">
            <CardHeader>
              <div class="flex items-center gap-3">
                <div class="rounded-2xl border border-border bg-muted p-2">
                  <Globe class="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>{{ t('appearance') }}</CardTitle>
                  <CardDescription>{{ t('appearanceDescription') }}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent class="space-y-6">
              <div class="grid gap-2">
                <Label>{{ t('language') }}</Label>
                <Select
                  :model-value="settingsStore.state.language"
                  @update:model-value="handleLanguageChange"
                >
                  <SelectTrigger class="w-full max-w-sm">
                    <SelectValue :placeholder="t('language')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">{{ t('chinese') }}</SelectItem>
                    <SelectItem value="en-US">{{ t('english') }}</SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-sm text-muted-foreground">{{ t('languageDescription') }}</p>
              </div>

              <div
                class="flex items-center justify-between rounded-2xl border border-border bg-muted/30 px-4 py-3"
              >
                <div class="space-y-1">
                  <p class="text-sm font-medium">{{ t('themeToggle') }}</p>
                  <p class="text-sm text-muted-foreground">{{ t('appearanceDescription') }}</p>
                </div>
                <ThemeToggleButton />
              </div>

              <div class="space-y-3">
                <div>
                  <Label>{{ t('themeColor') }}</Label>
                  <p class="mt-1 text-sm text-muted-foreground">
                    {{ t('themeColorDescription') }}
                  </p>
                </div>

                <div class="space-y-2">
                  <label class="text-xs font-medium text-muted-foreground">
                    {{ t('themeColorPresets') }}
                  </label>
                  <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <button
                      v-for="color in themePresetOptions"
                      :key="color"
                      type="button"
                      class="group flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/60"
                      :class="
                        themeAccentInput === APP_THEME_PRESET_COLORS[color]
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border/70 bg-background/70'
                      "
                      @click="applyThemeAccentPreset(color)"
                    >
                      <span
                        class="h-4 w-4 shrink-0 rounded-full border border-black/10 shadow-sm"
                        :style="{ backgroundColor: APP_THEME_PRESET_COLORS[color] }"
                      />
                      <span class="truncate text-xs font-medium">{{ t(color) }}</span>
                    </button>
                  </div>
                </div>

                <div class="space-y-2">
                  <label class="text-xs font-medium text-muted-foreground">
                    {{ t('customColor') }}
                  </label>
                  <div
                    class="flex items-center gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2"
                  >
                    <input
                      :value="themeAccentInput"
                      type="color"
                      class="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent p-0"
                      @input="handleThemeAccentInput(($event.target as HTMLInputElement).value)"
                    />
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-medium text-foreground">{{ t('selectedColor') }}</p>
                      <p class="truncate text-xs text-muted-foreground">
                        {{ themeAccentInput }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card class="border-border/70 shadow-sm">
            <CardHeader>
              <div class="flex items-center gap-3">
                <div class="rounded-2xl border border-border bg-muted p-2">
                  <MonitorCog class="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>{{ t('editor') }}</CardTitle>
                  <CardDescription>{{ t('editorDescription') }}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent class="grid gap-6 md:grid-cols-2">
              <div class="grid gap-2">
                <Label>{{ t('editorFontSize') }}</Label>
                <Select :model-value="fontSizeValue" @update:model-value="handleFontSizeChange">
                  <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('editorFontSize')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12 px</SelectItem>
                    <SelectItem value="14">14 px</SelectItem>
                    <SelectItem value="16">16 px</SelectItem>
                    <SelectItem value="18">18 px</SelectItem>
                    <SelectItem value="20">20 px</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div
                class="flex items-center justify-between rounded-2xl border border-border bg-muted/30 px-4 py-3"
              >
                <div class="space-y-1">
                  <Label>{{ t('editorMinimap') }}</Label>
                  <p class="text-sm text-muted-foreground">{{ t('editorDescription') }}</p>
                </div>
                <Switch
                  :checked="settingsStore.state.editorMinimap"
                  @update:checked="settingsStore.setEditorMinimap"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card class="border-border/70 shadow-sm">
          <CardHeader>
            <div class="flex items-center gap-3">
              <div class="rounded-2xl border border-border bg-muted p-2">
                <ShieldCheck class="h-5 w-5" />
              </div>
              <div>
                <CardTitle>{{ t('safety') }}</CardTitle>
                <CardDescription>{{ t('safetyDescription') }}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent class="space-y-6">
            <div
              class="flex items-center justify-between rounded-2xl border border-border bg-muted/30 px-4 py-3"
            >
              <div class="space-y-1">
                <Label>{{ t('confirmDelete') }}</Label>
                <p class="text-sm text-muted-foreground">{{ t('safetyDescription') }}</p>
              </div>
              <Switch
                :checked="settingsStore.state.confirmDelete"
                @update:checked="settingsStore.setConfirmDelete"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
