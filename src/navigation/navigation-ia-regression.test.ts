import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const canonicalLabels = ['Project Management', 'FPGA Flow', 'Virtual Device Platform'] as const
const canonicalModules = ['project-management', 'fpga-flow', 'virtual-device-platform'] as const

function countLiteral(source: string, token: string): number {
  return source.split(token).length - 1
}

describe('navigation IA regression', () => {
  it('keeps exactly three top-level module entries with canonical labels', () => {
    const sidebarPath = path.resolve(process.cwd(), 'src/components/AppSidebar.vue')
    const sidebarSource = readFileSync(sidebarPath, 'utf8')

    for (const label of canonicalLabels) {
      const occurrences = countLiteral(sidebarSource, `title: '${label}'`)
      expect(
        occurrences,
        `Navigation IA violation: expected exactly one top-level entry named "${label}", found ${occurrences}`,
      ).toBe(1)
    }

    const topLevelMatches = Array.from(sidebarSource.matchAll(/title:\s*'(.*?)'/g)).map(
      (match) => match[1],
    )
    const topLevelCanonicalCount = topLevelMatches.filter((title) =>
      canonicalLabels.includes(title as (typeof canonicalLabels)[number]),
    ).length

    expect(
      topLevelCanonicalCount,
      `Navigation IA violation: expected exactly 3 canonical top-level modules, found ${topLevelCanonicalCount}`,
    ).toBe(3)
  })

  it('keeps route-to-module mapping unique and constrained to canonical modules', () => {
    const routerPath = path.resolve(process.cwd(), 'src/router/index.ts')
    const routerSource = readFileSync(routerPath, 'utf8')

    const mappedModules = new Set(
      Array.from(
        routerSource.matchAll(/:\s*'(project-management|fpga-flow|virtual-device-platform)'/g),
      ).map((match) => match[1]),
    )

    expect(
      mappedModules.size,
      `Navigation IA violation: route-module mapping must contain exactly 3 unique modules, found ${mappedModules.size}`,
    ).toBe(3)

    expect(
      [...mappedModules].sort(),
      'Navigation IA violation: route-module mapping drifted from canonical module taxonomy',
    ).toEqual([...canonicalModules].sort())
  })
})
