<script setup lang="ts">
import { ArrowDownToLine, Globe, MonitorCog, ShieldCheck } from 'lucide-vue-next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { APP_THEME_PRESET_COLORS } from '@/lib/theme-accent'
import { CUSTOM_EDITOR_FONT_PRESET, useSettingsPageState } from '@/lib/settings-page'
import { DEFAULT_EDITOR_FONT_FAMILY } from '@/stores/settings'

const {
  applyThemeAccentPreset,
  canCheckForUpdates,
  canInstallUpdate,
  commitEditorFontFamily,
  editorFontFamilyInput,
  editorFontPresetOptions,
  editorFontPresetValue,
  fontSizeValue,
  formattedLastChecked,
  formattedReleaseDate,
  handleCheckForUpdates,
  handleConfirmDeleteChange,
  handleEditorFontPresetChange,
  handleEditorMinimapChange,
  handleFontSizeChange,
  handleInstallUpdate,
  handleLanguageChange,
  handleOpenReleases,
  handleThemeAccentInput,
  handleThemeModeChange,
  languageOptions,
  settingsState,
  t,
  themeAccentInput,
  themeModeOptions,
  themeModeThumbStyle,
  themePresetOptions,
  updateDownloadProgress,
  updateState,
  updateStatusLabel,
} = useSettingsPageState()
</script>

<template>
  <div class="h-full overflow-auto bg-transparent">
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
          <Card class="border-border/70">
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
                  :model-value="settingsState.language"
                  @update:model-value="handleLanguageChange"
                >
                  <SelectTrigger class="w-full max-w-sm">
                    <SelectValue :placeholder="t('language')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in languageOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p class="text-sm text-muted-foreground">{{ t('languageDescription') }}</p>
              </div>

              <div class="grid gap-2">
                <Label>{{ t('themeMode') }}</Label>
                <div
                  class="relative flex max-w-md rounded-2xl border border-border/60 bg-muted/28 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <div
                    class="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-[0.95rem] border border-border/70 bg-background/78 shadow-sm transition-transform duration-200 ease-out"
                    :style="themeModeThumbStyle"
                  />
                  <button
                    v-for="option in themeModeOptions"
                    :key="option.value"
                    type="button"
                    class="relative z-10 flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[0.95rem] px-3 py-2 text-left text-sm transition-colors"
                    :class="
                      settingsState.themeMode === option.value
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="handleThemeModeChange(option.value)"
                  >
                    <component :is="option.icon" class="h-4 w-4 shrink-0" />
                    <span class="truncate text-xs font-medium sm:text-sm">{{ option.label }}</span>
                  </button>
                </div>
                <p class="text-sm text-muted-foreground">{{ t('themeModeDescription') }}</p>
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

          <Card class="border-border/70">
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
              <div class="grid gap-2 md:col-span-2">
                <Label>{{ t('editorFont') }}</Label>
                <Select
                  :model-value="editorFontPresetValue"
                  @update:model-value="handleEditorFontPresetChange"
                >
                  <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('editorFont')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="option in editorFontPresetOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      <span class="text-sm" :style="{ fontFamily: option.value }">
                        {{ option.label }}
                      </span>
                    </SelectItem>
                    <SelectItem :value="CUSTOM_EDITOR_FONT_PRESET">
                      {{ t('custom') }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  v-model="editorFontFamilyInput"
                  :placeholder="DEFAULT_EDITOR_FONT_FAMILY"
                  @blur="commitEditorFontFamily"
                  @keydown.enter.prevent="commitEditorFontFamily"
                />
                <p class="text-sm text-muted-foreground">{{ t('editorFontDescription') }}</p>
              </div>

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
                  :checked="settingsState.editorMinimap"
                  @update:checked="handleEditorMinimapChange"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div class="grid gap-6">
          <Card class="border-border/70">
            <CardHeader>
              <div class="flex items-center gap-3">
                <div class="rounded-2xl border border-border bg-muted p-2">
                  <ArrowDownToLine class="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>{{ t('softwareUpdate') }}</CardTitle>
                  <CardDescription>{{ t('softwareUpdateDescription') }}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent class="space-y-6">
              <div class="grid gap-3">
                <div
                  class="grid gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3 sm:grid-cols-2"
                >
                  <div class="space-y-1">
                    <p
                      class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                      {{ t('currentVersion') }}
                    </p>
                    <p class="text-sm font-medium text-foreground">
                      {{ updateState.currentVersion }}
                    </p>
                  </div>
                  <div class="space-y-1">
                    <p
                      class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                      {{ t('updateStatus') }}
                    </p>
                    <p class="text-sm font-medium text-foreground">
                      {{ updateStatusLabel }}
                    </p>
                  </div>
                </div>

                <div
                  class="grid gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3 sm:grid-cols-2"
                >
                  <div class="space-y-1">
                    <p
                      class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                      {{ t('lastChecked') }}
                    </p>
                    <p class="text-sm text-foreground">
                      {{ formattedLastChecked }}
                    </p>
                  </div>
                  <div class="space-y-1">
                    <p
                      class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                      {{ t('updateSource') }}
                    </p>
                    <p class="text-sm text-foreground">
                      {{ t('signedGithubReleases') }}
                    </p>
                  </div>
                </div>
              </div>

              <div
                v-if="updateState.latestVersion"
                class="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4"
              >
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p
                      class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                      {{ t('latestVersion') }}
                    </p>
                    <p class="text-base font-semibold text-foreground">
                      {{ updateState.latestVersion }}
                    </p>
                  </div>
                  <div v-if="formattedReleaseDate" class="text-right">
                    <p
                      class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
                    >
                      {{ t('releaseDate') }}
                    </p>
                    <p class="text-sm text-foreground">
                      {{ formattedReleaseDate }}
                    </p>
                  </div>
                </div>

                <div v-if="updateState.latestBody" class="space-y-2">
                  <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    {{ t('releaseNotes') }}
                  </p>
                  <div
                    class="max-h-40 overflow-auto rounded-xl border border-border/80 bg-background px-3 py-2 text-sm text-muted-foreground"
                  >
                    <pre class="whitespace-pre-wrap font-sans">{{ updateState.latestBody }}</pre>
                  </div>
                </div>
              </div>

              <div
                v-if="updateDownloadProgress || updateState.errorMessage"
                class="rounded-2xl border border-border bg-background/70 px-4 py-3"
              >
                <p v-if="updateDownloadProgress" class="text-sm text-foreground">
                  {{ updateDownloadProgress }}
                </p>
                <p v-if="updateState.errorMessage" class="text-sm text-destructive">
                  {{ updateState.errorMessage }}
                </p>
              </div>

              <div class="flex flex-wrap gap-3">
                <Button :disabled="!canCheckForUpdates" @click="handleCheckForUpdates">
                  {{
                    updateState.status === 'checking'
                      ? t('checkingForUpdates')
                      : t('checkForUpdates')
                  }}
                </Button>
                <Button
                  variant="outline"
                  :disabled="!canInstallUpdate"
                  @click="handleInstallUpdate"
                >
                  {{ t('downloadAndInstall') }}
                </Button>
                <Button variant="ghost" @click="handleOpenReleases">
                  {{ t('viewReleases') }}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card class="border-border/70">
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
                  :checked="settingsState.confirmDelete"
                  @update:checked="handleConfirmDeleteChange"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>
