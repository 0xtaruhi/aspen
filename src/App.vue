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
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useAppShell } from '@/lib/app-shell'
import { useI18n } from '@/lib/i18n'

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
  <div class="app-shell-root min-h-screen text-foreground transition-colors">
    <NewProjectDialog v-model:open="showNewProjectDialog" />
    <ProjectUnsavedChangesDialog />
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset class="relative h-screen overflow-hidden flex flex-col">
        <header
          class="app-shell-header app-navigation-glass flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear z-10 group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12"
        >
          <div class="flex items-center gap-2 px-4 w-full">
            <SidebarTrigger class="-ml-1" />
            <Separator orientation="vertical" class="mr-2 h-4" />

            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem v-if="showModuleBreadcrumb" class="hidden md:block">
                  <BreadcrumbPage>{{ activeModuleLabel }}</BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator
                  v-if="showModuleBreadcrumb && showSurfaceBreadcrumb"
                  class="hidden md:block"
                />
                <BreadcrumbItem v-if="showSurfaceBreadcrumb">
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

        <div class="app-shell-workspace flex-1 min-h-0 overflow-hidden flex flex-col">
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

          <div class="flex-1 min-h-0 overflow-hidden">
            <RouterView />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  </div>
</template>

<style scoped>
.app-shell-root {
  background: transparent;
}

.app-shell-header {
  background: transparent;
}

.app-shell-workspace {
  background: var(--window-workspace-surface);
}

.app-shell-jobs {
  background: var(--window-muted-surface);
}

.app-shell-job-card {
  background: var(--window-card-surface);
}
</style>
