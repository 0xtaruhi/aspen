import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { projectStore } from '@/stores/project'
export * from './catalog'
import { modulePathMap } from './catalog'

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
    meta: { requiresProject: true },
    redirect: { name: 'fpga-flow-synthesis' },
  },
  {
    path: '/fpga-flow/synthesis',
    name: 'fpga-flow-synthesis',
    meta: { requiresProject: true },
    component: () => import('@/components/pages/Synthesis.vue'),
  },
  {
    path: '/fpga-flow/pin-planning',
    name: 'fpga-flow-pin-planning',
    meta: { requiresProject: true },
    component: () => import('@/components/pages/PinPlanning.vue'),
  },
  {
    path: '/fpga-flow/implementation',
    name: 'fpga-flow-implementation',
    meta: { requiresProject: true },
    component: () => import('@/components/pages/Implementation.vue'),
  },
  {
    path: '/fpga-flow/hardware',
    redirect: { name: 'hardware-manager' },
  },
  {
    path: modulePathMap['hardware-manager'],
    name: 'hardware-manager',
    component: () => import('@/components/pages/HardwareManager.vue'),
  },
  {
    path: modulePathMap['virtual-device-platform'],
    name: 'virtual-device-platform',
    meta: { requiresProject: true },
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

router.beforeEach((to) => {
  if (to.matched.some((record) => record.meta.requiresProject) && !projectStore.hasProject) {
    return { name: 'project-management-dashboard' }
  }

  return true
})

export default router
