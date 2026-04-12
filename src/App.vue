<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Settings2 } from 'lucide-vue-next'
import { RouterView, useRoute, useRouter } from 'vue-router'

import AppSidebar from '@/components/AppSidebar.vue'
import ProjectUnsavedChangesDialog from '@/components/project/ProjectUnsavedChangesDialog.vue'
import NewProjectDialog from '@/components/project/NewProjectDialog.vue'
import { Button } from '@/components/ui/button'
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
import {
  closeProject,
  openProject,
  resolveUnsavedProjectChanges,
  saveProject,
  saveProjectAs,
} from '@/lib/project-io'
import { routeLabelMap, routeRequiresProject, type AppRouteName } from '@/router'
import { appUpdateStore } from '@/stores/app-update'
import { hardwareStore } from '@/stores/hardware'
import { hardwareWorkbenchStore } from '@/stores/hardware-workbench'
import { projectStore } from '@/stores/project'
import { uiStore } from '@/stores/ui'

type AppMenuAction =
  | 'new-project'
  | 'open-project'
  | 'close-project'
  | 'save-project'
  | 'save-project-as'
  | 'open-settings'

interface BackgroundJobViewModel {
  label: string
  routeName: AppRouteName
}

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const showNewProjectDialog = ref(false)
let unlistenAppMenu: (() => void) | null = null
let unlistenCloseRequested: (() => void) | null = null
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
  'fpga-flow-pin-planning': 'pinPlanning',
  'fpga-flow-implementation': 'implementation',
  'hardware-manager': 'hardwareManager',
  'virtual-device-platform': 'virtualDevicePlatform',
  settings: 'settings',
} as const

const activeRouteName = computed(() => route.name as AppRouteName | undefined)
const hasAvailableUpdate = computed(() => appUpdateStore.state.status === 'available')
const backgroundJobs = computed<BackgroundJobViewModel[]>(() => {
  const jobs: BackgroundJobViewModel[] = []

  if (hardwareStore.synthesisRunning.value && activeRouteName.value !== 'fpga-flow-synthesis') {
    jobs.push({
      label: t('synthesis'),
      routeName: 'fpga-flow-synthesis',
    })
  }

  if (
    hardwareStore.implementationRunning.value &&
    activeRouteName.value !== 'fpga-flow-implementation'
  ) {
    jobs.push({
      label: t('implementation'),
      routeName: 'fpga-flow-implementation',
    })
  }

  return jobs
})

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

function openBackgroundJob(routeName: AppRouteName) {
  void router.push({ name: routeName })
}

async function prepareApplicationClose() {
  if (!(await resolveUnsavedProjectChanges('quit-application'))) {
    return false
  }

  if (!projectStore.hasProject) {
    return true
  }

  return await closeProject({ promptForUnsavedChanges: false })
}

function handleBrowserBeforeUnload(event: BeforeUnloadEvent) {
  if (!projectStore.hasProject || !projectStore.hasUnsavedChanges) {
    return
  }

  event.preventDefault()
  event.returnValue = ''
}

function handleAppMenuAction(action: AppMenuAction) {
  switch (action) {
    case 'new-project':
      showNewProjectDialog.value = true
      return
    case 'open-project':
      void openProject()
      return
    case 'close-project':
      void closeProject().then((closed) => {
        if (closed) {
          void router.push({ name: 'project-management-dashboard' })
        }
      })
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
    window.addEventListener('beforeunload', handleBrowserBeforeUnload)
  }

  void hardwareWorkbenchStore.boot().catch((err) => {
    console.error('Failed to boot Aspen hardware runtime', err)
  })

  void appUpdateStore.maybeAutoCheck().catch(() => undefined)

  if (!isTauri()) {
    return
  }

  void listen<AppMenuAction>('aspen://menu-action', (event) => {
    handleAppMenuAction(event.payload)
  }).then((unlisten) => {
    unlistenAppMenu = unlisten
  })

  const currentWindow = getCurrentWindow()
  void currentWindow
    .onCloseRequested(async (event) => {
      event.preventDefault()

      if (!(await prepareApplicationClose())) {
        return
      }

      await currentWindow.destroy()
    })
    .then((unlisten) => {
      unlistenCloseRequested = unlisten
    })
})

watch(
  [() => projectStore.hasProject, activeRouteName],
  ([hasProject, routeName]) => {
    if (!hasProject && routeRequiresProject(routeName)) {
      void router.replace({ name: 'project-management-dashboard' })
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleGlobalKeydown, { capture: true })
    window.removeEventListener('beforeunload', handleBrowserBeforeUnload)
  }

  if (unlistenAppMenu) {
    unlistenAppMenu()
    unlistenAppMenu = null
  }

  if (unlistenCloseRequested) {
    unlistenCloseRequested()
    unlistenCloseRequested = null
  }

  void hardwareWorkbenchStore.shutdown().catch(() => undefined)
  appUpdateStore.dispose()
})
</script>

<template>
  <div class="min-h-screen bg-background text-foreground transition-colors">
    <NewProjectDialog v-model:open="showNewProjectDialog" />
    <ProjectUnsavedChangesDialog />
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
                class="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                :title="t('settings')"
                :aria-label="t('openSettings')"
                @click="openSettings"
              >
                <span
                  v-if="hasAvailableUpdate"
                  class="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500"
                />
                <Settings2 class="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <div class="flex-1 min-h-0 overflow-hidden bg-background flex flex-col">
          <section
            v-if="backgroundJobs.length > 0"
            class="shrink-0 border-b border-border/70 bg-muted/30 px-4 py-3"
          >
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                {{ t('backgroundJobs') }}
              </span>
              <div
                v-for="job in backgroundJobs"
                :key="job.routeName"
                class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
              >
                <span class="text-sm font-medium">{{ job.label }}</span>
                <span class="text-xs text-muted-foreground">
                  {{ t('runningInBackground') }}
                </span>
                <Button size="sm" variant="outline" @click="openBackgroundJob(job.routeName)">
                  {{ t('view') }}
                </Button>
              </div>
            </div>
          </section>

          <div class="flex-1 min-h-0 overflow-hidden">
            <RouterView />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  </div>
</template>
