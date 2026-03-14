import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

export type AppModule = 'project-management' | 'fpga-flow' | 'virtual-device-platform' | 'settings'

export type Page =
  | 'project-editor'
  | 'project-dashboard'
  | 'synthesis'
  | 'implementation'
  | 'hardware'
  | 'virtual-device'
  | 'settings'

export type AppRouteName =
  | 'project-management'
  | 'project-management-editor'
  | 'project-management-dashboard'
  | 'fpga-flow'
  | 'fpga-flow-synthesis'
  | 'fpga-flow-implementation'
  | 'fpga-flow-hardware'
  | 'virtual-device-platform'
  | 'settings'

export const moduleLabelMap: Record<AppModule, string> = {
  'project-management': 'Project Management',
  'fpga-flow': 'FPGA Flow',
  'virtual-device-platform': 'Virtual Device Platform',
  settings: 'Settings',
}

export const routeLabelMap: Record<AppRouteName, string> = {
  'project-management': 'Dashboard',
  'project-management-editor': 'Editor',
  'project-management-dashboard': 'Dashboard',
  'fpga-flow': 'Synthesis',
  'fpga-flow-synthesis': 'Synthesis',
  'fpga-flow-implementation': 'Implementation',
  'fpga-flow-hardware': 'Hardware Manager',
  'virtual-device-platform': 'Workbench',
  settings: 'Settings',
}

export const routeModuleMap: Record<AppRouteName, AppModule> = {
  'project-management': 'project-management',
  'project-management-editor': 'project-management',
  'project-management-dashboard': 'project-management',
  'fpga-flow': 'fpga-flow',
  'fpga-flow-synthesis': 'fpga-flow',
  'fpga-flow-implementation': 'fpga-flow',
  'fpga-flow-hardware': 'fpga-flow',
  'virtual-device-platform': 'virtual-device-platform',
  settings: 'settings',
}

export const routePageMap: Partial<Record<AppRouteName, Page>> = {
  'project-management': 'project-dashboard',
  'project-management-editor': 'project-editor',
  'project-management-dashboard': 'project-dashboard',
  'fpga-flow': 'synthesis',
  'fpga-flow-synthesis': 'synthesis',
  'fpga-flow-implementation': 'implementation',
  'fpga-flow-hardware': 'hardware',
  'virtual-device-platform': 'virtual-device',
  settings: 'settings',
}

export const pageRouteNameMap: Record<Page, AppRouteName> = {
  'project-editor': 'project-management-editor',
  'project-dashboard': 'project-management-dashboard',
  synthesis: 'fpga-flow-synthesis',
  implementation: 'fpga-flow-implementation',
  hardware: 'fpga-flow-hardware',
  'virtual-device': 'virtual-device-platform',
  settings: 'settings',
}

export const moduleDefaultRouteName: Record<AppModule, AppRouteName> = {
  'project-management': 'project-management-dashboard',
  'fpga-flow': 'fpga-flow-synthesis',
  'virtual-device-platform': 'virtual-device-platform',
  settings: 'settings',
}

export const modulePathMap: Record<AppModule, string> = {
  'project-management': '/project-management',
  'fpga-flow': '/fpga-flow',
  'virtual-device-platform': '/virtual-device-platform',
  settings: '/settings',
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: { name: 'project-management-dashboard' },
  },
  {
    path: modulePathMap['project-management'],
    name: 'project-management',
    redirect: { name: 'project-management-dashboard' },
  },
  {
    path: '/project-management/editor',
    name: 'project-management-editor',
    component: () => import('@/components/pages/ProjectEditorWorkspace.vue'),
  },
  {
    path: '/project-management/dashboard',
    name: 'project-management-dashboard',
    component: () => import('@/components/pages/ProjectStatus.vue'),
  },
  {
    path: modulePathMap['fpga-flow'],
    name: 'fpga-flow',
    redirect: { name: 'fpga-flow-synthesis' },
  },
  {
    path: '/fpga-flow/synthesis',
    name: 'fpga-flow-synthesis',
    component: () => import('@/components/pages/Synthesis.vue'),
  },
  {
    path: '/fpga-flow/implementation',
    name: 'fpga-flow-implementation',
    component: () => import('@/components/pages/Implementation.vue'),
  },
  {
    path: '/fpga-flow/hardware',
    name: 'fpga-flow-hardware',
    component: () => import('@/components/pages/HardwareManager.vue'),
  },
  {
    path: modulePathMap['virtual-device-platform'],
    name: 'virtual-device-platform',
    component: () => import('@/components/pages/VirtualDevicePlatform.vue'),
  },
  {
    path: modulePathMap.settings,
    name: 'settings',
    component: () => import('@/components/pages/SettingsPage.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'project-management-dashboard' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
