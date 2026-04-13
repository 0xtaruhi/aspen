import type { UnlistenFn } from '@tauri-apps/api/event'
import type { Window } from '@tauri-apps/api/window'
import type { MessageKey } from '@/lib/i18n'
import type { AppModule, AppRouteName } from '@/router'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'

import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { installNativeContextMenuGuard } from '@/lib/native-context-menu'
import {
  closeProject,
  openProject,
  resolveUnsavedProjectChanges,
  saveProject,
  saveProjectAs,
} from '@/lib/project-io'
import { moduleForRouteName, routeLabelMap, routeRequiresProject } from '@/router/catalog'
import { appUpdateStore } from '@/stores/app-update'
import { hardwareStore } from '@/stores/hardware'
import { hardwareWorkbenchStore } from '@/stores/hardware-workbench'
import { projectStore } from '@/stores/project'

export type AppMenuAction =
  | 'new-project'
  | 'open-project'
  | 'close-project'
  | 'save-project'
  | 'save-project-as'
  | 'open-settings'

export interface BackgroundJobViewModel {
  label: string
  routeName: AppRouteName
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

interface SurfaceLabelOptions {
  routeName: AppRouteName | undefined
  activeFileName?: string
  activeFileId?: string
  isActiveFileDirty?: boolean
  t: Translate
}

const GLOBAL_KEYDOWN_LISTENER_OPTIONS = { capture: true } as const

const moduleLabelKeyMap: Record<AppModule, MessageKey> = {
  'project-management': 'projectManagement',
  'fpga-flow': 'fpgaFlow',
  'hardware-manager': 'hardwareManager',
  'virtual-device-platform': 'virtualDevicePlatform',
  settings: 'settings',
}

const routeLabelKeyMap: Partial<Record<AppRouteName, MessageKey>> = {
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
}

export function buildBackgroundJobs(
  activeRouteName: AppRouteName | undefined,
  synthesisRunning: boolean,
  implementationRunning: boolean,
  t: Translate,
): BackgroundJobViewModel[] {
  const jobs: BackgroundJobViewModel[] = []

  if (synthesisRunning && activeRouteName !== 'fpga-flow-synthesis') {
    jobs.push({
      label: t('synthesis'),
      routeName: 'fpga-flow-synthesis',
    })
  }

  if (implementationRunning && activeRouteName !== 'fpga-flow-implementation') {
    jobs.push({
      label: t('implementation'),
      routeName: 'fpga-flow-implementation',
    })
  }

  return jobs
}

export function resolveAppShellModuleLabel(
  activeRouteName: AppRouteName | undefined,
  t: Translate,
): string {
  if (activeRouteName === 'settings') {
    return t('application')
  }

  if (!activeRouteName) {
    return t('workspace')
  }

  const moduleName = moduleForRouteName(activeRouteName)
  const key = moduleName ? moduleLabelKeyMap[moduleName] : null
  return key ? t(key) : t('workspace')
}

export function resolveAppShellSurfaceLabel({
  routeName,
  activeFileName,
  activeFileId,
  isActiveFileDirty,
  t,
}: SurfaceLabelOptions): string {
  if (routeName === 'settings') {
    return t('settings')
  }

  if (routeName === 'project-management-editor') {
    const fileName = activeFileName || t('noFileSelected')
    return activeFileId && isActiveFileDirty ? `${fileName} *` : fileName
  }

  if (!routeName) {
    return t('workspace')
  }

  const key = routeLabelKeyMap[routeName]
  return key ? t(key) : routeLabelMap[routeName]
}

export function shouldShowModuleBreadcrumb(activeRouteName: AppRouteName | undefined) {
  return activeRouteName !== 'project-management-editor'
}

export function shouldShowSurfaceBreadcrumb(
  showModuleBreadcrumb: boolean,
  moduleLabel: string,
  surfaceLabel: string,
) {
  if (!showModuleBreadcrumb) {
    return true
  }

  return moduleLabel !== surfaceLabel
}

async function closeProjectAndReturnToDashboard(router: Router) {
  if (await closeProject()) {
    await router.push({ name: 'project-management-dashboard' })
  }
}

async function confirmUnsavedChangesBeforeWindowClose(
  currentWindow: Window,
  closePromptPending: { value: boolean },
) {
  if (closePromptPending.value) {
    return
  }

  closePromptPending.value = true
  try {
    if (await resolveUnsavedProjectChanges('quit-application')) {
      await currentWindow.destroy()
    }
  } catch (error) {
    console.error('Failed to resolve close confirmation', error)
  } finally {
    closePromptPending.value = false
  }
}

export function useAppShell(route: RouteLocationNormalizedLoaded, router: Router, t: Translate) {
  const showNewProjectDialog = ref(false)
  const closePromptPending = ref(false)
  const activeRouteName = computed(() => route.name as AppRouteName | undefined)
  const hasAvailableUpdate = computed(() => appUpdateStore.state.status === 'available')
  const backgroundJobs = computed(() =>
    buildBackgroundJobs(
      activeRouteName.value,
      hardwareStore.synthesisRunning.value,
      hardwareStore.implementationRunning.value,
      t,
    ),
  )
  const activeModuleLabel = computed(() => resolveAppShellModuleLabel(activeRouteName.value, t))
  const activeSurfaceLabel = computed(() =>
    resolveAppShellSurfaceLabel({
      routeName: activeRouteName.value,
      activeFileName: projectStore.activeFile?.name,
      activeFileId: projectStore.activeFileId,
      isActiveFileDirty:
        !!projectStore.activeFileId && projectStore.isFileDirty(projectStore.activeFileId),
      t,
    }),
  )
  const showModuleBreadcrumb = computed(() => shouldShowModuleBreadcrumb(activeRouteName.value))
  const showSurfaceBreadcrumb = computed(() =>
    shouldShowSurfaceBreadcrumb(
      showModuleBreadcrumb.value,
      activeModuleLabel.value,
      activeSurfaceLabel.value,
    ),
  )

  let unlistenAppMenu: UnlistenFn | null = null
  let unlistenCloseRequested: UnlistenFn | null = null
  let uninstallContextMenuGuard: (() => void) | null = null

  function openSettings() {
    void router.push({ name: 'settings' })
  }

  function openBackgroundJob(routeName: AppRouteName) {
    void router.push({ name: routeName })
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
        void closeProjectAndReturnToDashboard(router)
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

  function handleGlobalKeydown(event: KeyboardEvent) {
    const commandKey = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (isTauri() && (key === 'f5' || (commandKey && key === 'r'))) {
      event.preventDefault()
      return
    }

    if (!commandKey) {
      return
    }

    if (key === 'n') {
      event.preventDefault()
      showNewProjectDialog.value = true
      return
    }

    if (key === 'o') {
      event.preventDefault()
      void openProject()
      return
    }

    if (key === ',') {
      event.preventDefault()
      openSettings()
      return
    }

    if (key === 'w' && event.shiftKey) {
      event.preventDefault()
      void closeProjectAndReturnToDashboard(router)
      return
    }

    if (key === 's' && projectStore.hasProject) {
      event.preventDefault()
      if (event.shiftKey) {
        void saveProjectAs()
        return
      }
      void saveProject()
    }
  }

  watch(
    [() => projectStore.hasProject, activeRouteName],
    ([hasProject, routeName]) => {
      if (!hasProject && routeRequiresProject(routeName)) {
        void router.replace({ name: 'project-management-dashboard' })
      }
    },
    { immediate: true },
  )

  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleGlobalKeydown, GLOBAL_KEYDOWN_LISTENER_OPTIONS)
    }

    void hardwareWorkbenchStore.boot().catch((error) => {
      console.error('Failed to boot Aspen hardware runtime', error)
    })

    void appUpdateStore.maybeAutoCheck().catch(() => undefined)

    if (!isTauri()) {
      return
    }

    uninstallContextMenuGuard = installNativeContextMenuGuard()

    void listen<AppMenuAction>('aspen://menu-action', (event) => {
      handleAppMenuAction(event.payload)
    }).then((unlisten) => {
      unlistenAppMenu = unlisten
    })

    const currentWindow = getCurrentWindow()
    void currentWindow
      .onCloseRequested((event) => {
        if (!projectStore.hasProject || !projectStore.hasUnsavedChanges) {
          return
        }

        event.preventDefault()
        void confirmUnsavedChangesBeforeWindowClose(currentWindow, closePromptPending)
      })
      .then((unlisten) => {
        unlistenCloseRequested = unlisten
      })
  })

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeydown, GLOBAL_KEYDOWN_LISTENER_OPTIONS)
    }

    if (unlistenAppMenu) {
      unlistenAppMenu()
      unlistenAppMenu = null
    }

    if (unlistenCloseRequested) {
      unlistenCloseRequested()
      unlistenCloseRequested = null
    }

    if (uninstallContextMenuGuard) {
      uninstallContextMenuGuard()
      uninstallContextMenuGuard = null
    }

    void hardwareWorkbenchStore.shutdown().catch(() => undefined)
    appUpdateStore.dispose()
  })

  return {
    activeModuleLabel,
    activeSurfaceLabel,
    backgroundJobs,
    hasAvailableUpdate,
    openBackgroundJob,
    openSettings,
    showModuleBreadcrumb,
    showNewProjectDialog,
    showSurfaceBreadcrumb,
  }
}
