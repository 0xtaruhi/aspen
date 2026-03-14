import { computed } from 'vue'

import router, {
  type AppModule,
  type AppRouteName,
  type Page,
  moduleDefaultRouteName,
  modulePathMap,
  pageRouteNameMap,
  routeModuleMap,
  routePageMap,
} from '@/router'

const fallbackRouteByModule: Record<AppModule, AppRouteName> = {
  'project-management': 'project-management-dashboard',
  'fpga-flow': 'fpga-flow-synthesis',
  'virtual-device-platform': 'virtual-device-platform',
  settings: 'settings',
}

export const uiStore = {
  activePage: computed<Page>(() => {
    const routeName = router.currentRoute.value.name as AppRouteName | undefined
    if (!routeName) {
      return 'project-editor'
    }

    return routePageMap[routeName] ?? 'project-editor'
  }),

  activeModule: computed<AppModule>(() => {
    const routeName = router.currentRoute.value.name as AppRouteName | undefined
    if (!routeName) {
      return 'project-management'
    }

    return routeModuleMap[routeName] ?? 'project-management'
  }),

  setPage(page: Page) {
    const routeName = pageRouteNameMap[page]
    void router.push({ name: routeName })
  },

  setModule(moduleName: AppModule) {
    const routeName = moduleDefaultRouteName[moduleName] ?? fallbackRouteByModule[moduleName]
    void router.push({ name: routeName })
  },

  setModulePath(path: AppModule) {
    void router.push(modulePathMap[path])
  },
}
