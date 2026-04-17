<script setup lang="ts">
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
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useAppShell } from '@/lib/app-shell'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { isMacDesktop } from '@/lib/window-frame'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const {
  activeModuleLabel,
  activeSurfaceLabel,
  backgroundJobs,
  hasAvailableUpdate,
  openBackgroundJob,
  openSettings,
  showModuleBreadcrumb,
  showNewProjectDialog,
  showSurfaceBreadcrumb,
} = useAppShell(route, router, t)
</script>

<template>
  <div
    :class="
      cn(
        'app-shell-root h-full min-h-0 text-foreground transition-colors',
        isMacDesktop && 'app-shell-root-native-frame',
      )
    "
  >
    <NewProjectDialog v-model:open="showNewProjectDialog" />
    <ProjectUnsavedChangesDialog />
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset class="relative flex h-full min-h-0 flex-col">
        <header
          class="app-shell-header app-navigation-glass flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear z-10 group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12"
        >
          <div class="flex w-full items-center gap-2 px-4" data-tauri-drag-region>
            <div
              v-if="isMacDesktop"
              aria-hidden="true"
              class="app-shell-titlebar-safe-area hidden w-0 shrink-0 group-has-[[data-collapsible=icon]]/sidebar-wrapper:block group-has-[[data-collapsible=icon]]/sidebar-wrapper:w-[0.75rem]"
            />
            <SidebarTrigger class="-ml-1" data-tauri-drag-region="false" />

            <Breadcrumb class="app-shell-breadcrumb">
              <BreadcrumbList class="app-shell-breadcrumb-list">
                <BreadcrumbItem v-if="showModuleBreadcrumb" class="hidden md:block">
                  <BreadcrumbPage class="app-shell-breadcrumb-page">
                    {{ activeModuleLabel }}
                  </BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator
                  v-if="showModuleBreadcrumb && showSurfaceBreadcrumb"
                  class="app-shell-breadcrumb-separator hidden md:flex"
                />
                <BreadcrumbItem v-if="showSurfaceBreadcrumb">
                  <BreadcrumbPage class="app-shell-breadcrumb-page">
                    {{ activeSurfaceLabel }}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div class="ml-auto flex items-center gap-2" data-tauri-drag-region="false">
              <button
                class="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent/72 hover:text-accent-foreground"
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

        <div
          :class="
            cn(
              'app-shell-stage flex min-h-0 flex-1 flex-col',
              isMacDesktop && 'app-shell-stage-native-frame',
            )
          "
        >
          <div class="app-shell-workspace flex min-h-0 flex-1 flex-col overflow-hidden">
            <section
              v-if="backgroundJobs.length > 0"
              class="app-shell-jobs shrink-0 border-b border-border/70 px-4 py-3"
            >
              <div class="flex flex-wrap items-center gap-3">
                <span class="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {{ t('backgroundJobs') }}
                </span>
                <div
                  v-for="job in backgroundJobs"
                  :key="job.routeName"
                  class="app-shell-job-card flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
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

            <div class="min-h-0 flex-1 overflow-hidden">
              <RouterView />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  </div>
</template>

<style scoped>
.app-shell-root-native-frame {
  overflow: clip;
  background:
    radial-gradient(circle at 18% 0%, var(--window-workspace-ambient), transparent 36rem),
    color-mix(in oklab, var(--background) 28%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--border) 28%, transparent);
}

.app-shell-workspace {
  position: relative;
  isolation: isolate;
  border-radius: calc(var(--radius-xl) + 8px);
  border: 1px solid color-mix(in oklab, var(--border) 86%, transparent);
  background:
    radial-gradient(circle at 18% 0%, var(--window-workspace-ambient), transparent 34rem),
    var(--window-workspace-surface);
  box-shadow:
    0 0 0 0.5px color-mix(in oklab, black 8%, transparent),
    10px 16px 28px -22px color-mix(in oklab, black 16%, transparent),
    4px 8px 16px -14px color-mix(in oklab, black 10%, transparent);
}

.app-shell-root-native-frame .app-shell-workspace {
  border-radius: calc(var(--radius-xl) + 2px);
}

.app-shell-breadcrumb {
  display: flex;
  min-height: 2rem;
  align-items: center;
}

.app-shell-breadcrumb-list {
  min-height: 2rem;
  align-items: center;
}

.app-shell-breadcrumb-page,
.app-shell-breadcrumb-separator {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.app-shell-titlebar-safe-area {
  transition: width 180ms ease;
}

.app-shell-stage {
  padding: 0.2rem 0.5rem 0.5rem 0.35rem;
  /* Intentionally constrain the left edge so the workspace shadow stays out of
   * the sidebar rail instead of bleeding across the chrome boundary. */
  clip-path: inset(-80px -80px -80px 0);
}

.app-shell-stage-native-frame {
  padding: 0.2rem 0.5rem 0.5rem 0;
  transition: padding 180ms ease;
}

.app-shell-jobs {
  background: var(--window-muted-surface);
}

.app-shell-job-card {
  background: var(--window-card-surface);
}

@media (max-width: 768px) {
  .app-shell-stage {
    padding: 0.15rem 0.35rem 0.35rem;
  }

  .app-shell-stage-native-frame {
    padding-left: 0;
  }

  .app-shell-workspace {
    border-radius: calc(var(--radius-xl) + 4px);
  }
}
</style>
