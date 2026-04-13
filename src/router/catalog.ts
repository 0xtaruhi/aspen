export type AppModule =
  | 'project-management'
  | 'fpga-flow'
  | 'hardware-manager'
  | 'virtual-device-platform'
  | 'settings'

export type Page =
  | 'project-editor'
  | 'project-dashboard'
  | 'synthesis'
  | 'pin-planning'
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
  | 'fpga-flow-pin-planning'
  | 'fpga-flow-implementation'
  | 'hardware-manager'
  | 'virtual-device-platform'
  | 'settings'

export const moduleLabelMap: Record<AppModule, string> = {
  'project-management': 'Project Management',
  'fpga-flow': 'FPGA Flow',
  'hardware-manager': 'Hardware Manager',
  'virtual-device-platform': 'Virtual Device Platform',
  settings: 'Settings',
}

export const routeLabelMap: Record<AppRouteName, string> = {
  'project-management': 'Dashboard',
  'project-management-editor': 'Editor',
  'project-management-dashboard': 'Dashboard',
  'fpga-flow': 'Synthesis',
  'fpga-flow-synthesis': 'Synthesis',
  'fpga-flow-pin-planning': 'Pin Planning',
  'fpga-flow-implementation': 'Implementation',
  'hardware-manager': 'Hardware Manager',
  'virtual-device-platform': 'Virtual Device Platform',
  settings: 'Settings',
}

export const routeModuleMap: Record<AppRouteName, AppModule> = {
  'project-management': 'project-management',
  'project-management-editor': 'project-management',
  'project-management-dashboard': 'project-management',
  'fpga-flow': 'fpga-flow',
  'fpga-flow-synthesis': 'fpga-flow',
  'fpga-flow-pin-planning': 'fpga-flow',
  'fpga-flow-implementation': 'fpga-flow',
  'hardware-manager': 'hardware-manager',
  'virtual-device-platform': 'virtual-device-platform',
  settings: 'settings',
}

export const routePageMap: Partial<Record<AppRouteName, Page>> = {
  'project-management': 'project-dashboard',
  'project-management-editor': 'project-editor',
  'project-management-dashboard': 'project-dashboard',
  'fpga-flow': 'synthesis',
  'fpga-flow-synthesis': 'synthesis',
  'fpga-flow-pin-planning': 'pin-planning',
  'fpga-flow-implementation': 'implementation',
  'hardware-manager': 'hardware',
  'virtual-device-platform': 'virtual-device',
  settings: 'settings',
}

export const pageRouteNameMap: Record<Page, AppRouteName> = {
  'project-editor': 'project-management-editor',
  'project-dashboard': 'project-management-dashboard',
  synthesis: 'fpga-flow-synthesis',
  'pin-planning': 'fpga-flow-pin-planning',
  implementation: 'fpga-flow-implementation',
  hardware: 'hardware-manager',
  'virtual-device': 'virtual-device-platform',
  settings: 'settings',
}

export const moduleDefaultRouteName: Record<AppModule, AppRouteName> = {
  'project-management': 'project-management-dashboard',
  'fpga-flow': 'fpga-flow-synthesis',
  'hardware-manager': 'hardware-manager',
  'virtual-device-platform': 'virtual-device-platform',
  settings: 'settings',
}

export const modulePathMap: Record<AppModule, string> = {
  'project-management': '/project-management',
  'fpga-flow': '/fpga-flow',
  'hardware-manager': '/hardware-manager',
  'virtual-device-platform': '/virtual-device-platform',
  settings: '/settings',
}

export function moduleForRouteName(routeName: AppRouteName | undefined): AppModule | null {
  return routeName ? routeModuleMap[routeName] : null
}

export function pageForRouteName(routeName: AppRouteName | undefined): Page | null {
  return routeName ? (routePageMap[routeName] ?? null) : null
}

export function routeRequiresProject(routeName: AppRouteName | undefined) {
  return (
    routeName === 'fpga-flow' ||
    routeName === 'fpga-flow-synthesis' ||
    routeName === 'fpga-flow-pin-planning' ||
    routeName === 'fpga-flow-implementation' ||
    routeName === 'virtual-device-platform'
  )
}
