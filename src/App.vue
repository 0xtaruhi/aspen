<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Settings2 } from 'lucide-vue-next'
import { RouterView, useRoute, useRouter } from 'vue-router'

import AppSidebar from '@/components/AppSidebar.vue'
import NewProjectDialog from '@/components/project/NewProjectDialog.vue'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useI18n } from '@/lib/i18n'
import { openProject, saveProject, saveProjectAs } from '@/lib/project-io'
import ThemeToggleButton from '@/components/ThemeToggleButton.vue'
import { routeLabelMap, type AppRouteName } from '@/router'
import { projectStore } from '@/stores/project'
import { uiStore } from '@/stores/ui'

type AppMenuAction =
  | 'new-project'
  | 'open-project'
  | 'save-project'
  | 'save-project-as'
  | 'open-settings'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const showNewProjectDialog = ref(false)
let unlistenAppMenu: (() => void) | null = null
const moduleLabelKeyMap = {
  'project-management': 'projectManagement',
  'fpga-flow': 'fpgaFlow',
  'hardware-manager': 'hardwareManager',
  'virtual-device-platform': 'virtualDevicePlatform',
  settings: 'settings',
} as const
const routeLabelKeyMap = {
  'project-management': 'dashboard',
  'project-management-editor': 'projectManagement',
  'project-management-dashboard': 'dashboard',
  'fpga-flow': 'synthesis',
  'fpga-flow-synthesis': 'synthesis',
  'fpga-flow-netlist-browser': 'netlistBrowser',
  'fpga-flow-pin-planning': 'pinPlanning',
  'fpga-flow-implementation': 'implementation',
  'hardware-manager': 'hardwareManager',
  'virtual-device-platform': 'virtualDevicePlatform',
  settings: 'settings',
} as const

const activeRouteName = computed(() => route.name as AppRouteName | undefined)

const activeModuleLabel = computed(() => {
  if (activeRouteName.value === 'settings') {
    return t('application')
  }

  const key = moduleLabelKeyMap[uiStore.activeModule.value]
  return key ? t(key) : t('workspace')
})

const activeSurfaceLabel = computed(() => {
  if (activeRouteName.value === 'settings') {
    return t('settings')
  }

  if (uiStore.activePage.value === 'project-editor') {
    const fileName = projectStore.activeFile?.name || t('noFileSelected')
    return projectStore.activeFileId && projectStore.isFileDirty(projectStore.activeFileId)
      ? `${fileName} *`
      : fileName
  }

  const routeName = activeRouteName.value
  if (!routeName) {
    return t('workspace')
  }

  const key = routeLabelKeyMap[routeName]
  return key ? t(key) : routeLabelMap[routeName]
})

const shouldShowModuleBreadcrumb = computed(() => {
  return uiStore.activePage.value !== 'project-editor'
})

const shouldShowSurfaceBreadcrumb = computed(() => {
  if (!shouldShowModuleBreadcrumb.value) {
    return true
  }

  return activeModuleLabel.value !== activeSurfaceLabel.value
})

function handleGlobalKeydown(event: KeyboardEvent) {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 's' &&
    projectStore.hasProject
  ) {
    event.preventDefault()
    void saveProject()
  }
}

function openSettings() {
  void router.push({ name: 'settings' })
}

function handleAppMenuAction(action: AppMenuAction) {
  switch (action) {
    case 'new-project':
      showNewProjectDialog.value = true
      return
    case 'open-project':
      void openProject()
      return
    case 'save-project':
      void saveProject()
      return
    case 'save-project-as':
      void saveProjectAs()
      return
    case 'open-settings':
      openSettings()
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleGlobalKeydown, { capture: true })
  }

  if (!isTauri()) {
    return
  }

  void listen<AppMenuAction>('aspen://menu-action', (event) => {
    handleAppMenuAction(event.payload)
  }).then((unlisten) => {
    unlistenAppMenu = unlisten
  })
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleGlobalKeydown, { capture: true })
  }

  if (unlistenAppMenu) {
    unlistenAppMenu()
    unlistenAppMenu = null
  }
})
</script>

<template>
  <div class="min-h-screen bg-background text-foreground transition-colors">
    <NewProjectDialog v-model:open="showNewProjectDialog" />
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset class="relative h-screen overflow-hidden flex flex-col">
        <header
          class="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/50 transition-[width,height] ease-linear backdrop-blur z-10 group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12"
        >
          <div class="flex items-center gap-2 px-4 w-full">
            <SidebarTrigger class="-ml-1" />
            <Separator orientation="vertical" class="mr-2 h-4" />

            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem v-if="shouldShowModuleBreadcrumb" class="hidden md:block">
                  <BreadcrumbPage>{{ activeModuleLabel }}</BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator
                  v-if="shouldShowModuleBreadcrumb && shouldShowSurfaceBreadcrumb"
                  class="hidden md:block"
                />
                <BreadcrumbItem v-if="shouldShowSurfaceBreadcrumb">
                  <BreadcrumbPage>{{ activeSurfaceLabel }}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div class="ml-auto flex items-center gap-2">
              <button
                class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-9 w-9"
                :title="t('settings')"
                :aria-label="t('openSettings')"
                @click="openSettings"
              >
                <Settings2 class="h-4 w-4" />
              </button>
              <ThemeToggleButton />
            </div>
          </div>
        </header>

        <div class="flex-1 min-h-0 overflow-hidden bg-background">
          <RouterView />
        </div>
      </SidebarInset>
    </SidebarProvider>
  </div>
</template>
