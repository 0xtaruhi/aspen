import { describe, expect, it } from 'vitest'
import type { MessageKey } from '@/lib/i18n'

import {
  buildBackgroundJobs,
  resolveAppShellModuleLabel,
  resolveAppShellSurfaceLabel,
  shouldShowModuleBreadcrumb,
  shouldShowSurfaceBreadcrumb,
} from './app-shell'

const translations = {
  application: 'Application',
  workspace: 'Workspace',
  settings: 'Settings',
  projectManagement: 'Project Management',
  fpgaFlow: 'FPGA Flow',
  hardwareManager: 'Hardware Manager',
  virtualDevicePlatform: 'Virtual Device Platform',
  dashboard: 'Dashboard',
  synthesis: 'Synthesis',
  pinPlanning: 'Pin Planning',
  implementation: 'Implementation',
  noFileSelected: 'No top file selected',
} as const

function t(key: MessageKey) {
  return translations[key as keyof typeof translations] ?? key
}

describe('app shell helpers', () => {
  it('builds background jobs only for off-screen running stages', () => {
    expect(buildBackgroundJobs('fpga-flow-synthesis', true, true, t)).toEqual([
      {
        label: 'Implementation',
        routeName: 'fpga-flow-implementation',
      },
    ])
  })

  it('resolves module labels with settings special case', () => {
    expect(resolveAppShellModuleLabel('settings', t)).toBe('Application')
    expect(resolveAppShellModuleLabel('virtual-device-platform', t)).toBe('Virtual Device Platform')
  })

  it('resolves the editor surface label and keeps dirty marker local to the file', () => {
    expect(
      resolveAppShellSurfaceLabel({
        routeName: 'project-management-editor',
        activeFileName: 'Top.v',
        activeFileId: 'file-1',
        isActiveFileDirty: true,
        t,
      }),
    ).toBe('Top.v *')

    expect(
      resolveAppShellSurfaceLabel({
        routeName: 'project-management-editor',
        t,
      }),
    ).toBe('No top file selected')
  })

  it('derives breadcrumb visibility from the resolved labels', () => {
    expect(shouldShowModuleBreadcrumb('project-management-editor')).toBe(false)
    expect(shouldShowSurfaceBreadcrumb(false, 'Project Management', 'Top.v *')).toBe(true)
    expect(shouldShowSurfaceBreadcrumb(true, 'Hardware Manager', 'Hardware Manager')).toBe(false)
  })
})
