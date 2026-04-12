import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const rootStores = ['hardware.ts', 'hardware-runtime.ts', 'project.ts']

const runtimeDomainFields = ['phase', 'last_error', 'device', 'artifact', 'op_id']

function readStoreSource(fileName: string): string {
  return readFileSync(path.resolve(process.cwd(), 'src/stores', fileName), 'utf8')
}

function makeForbiddenImportPattern(storeName: string): RegExp {
  return new RegExp(String.raw`from\s+['"](?:@/stores|\.\.)/${storeName}(?:\.ts)?['"]`)
}

function makeForbiddenFieldMutationPattern(fieldName: string): RegExp {
  return new RegExp(
    String.raw`(?:\.${fieldName}\s*=|\[['"]${fieldName}['"]\]\s*=|\b${fieldName}\s*\+\+|\b${fieldName}\s*--)`,
  )
}

describe('store boundary contract regression', () => {
  it('disallows forbidden cross-store coupling imports', () => {
    for (const fileName of rootStores) {
      const source = readStoreSource(fileName)
      const storeBaseName = fileName.replace(/\.ts$/, '')

      for (const candidate of rootStores) {
        const candidateBaseName = candidate.replace(/\.ts$/, '')
        if (candidateBaseName === storeBaseName) {
          continue
        }

        expect(
          source,
          `Boundary violation: src/stores/${fileName} must not directly import src/stores/${candidateBaseName}.ts`,
        ).not.toMatch(makeForbiddenImportPattern(candidateBaseName))
      }
    }
  })

  it('keeps failure detector active with a negative assertion sample', () => {
    const forbiddenImportSample = "import { uiStore } from '@/stores/ui'"

    expect(
      forbiddenImportSample,
      'Boundary test integrity failure: expected forbidden import sample to be detected, but pattern did not match',
    ).toMatch(makeForbiddenImportPattern('ui'))
  })

  it('forbids project canvas store from mutating runtime-domain fields/contracts', () => {
    const source = readStoreSource('project-canvas.ts')

    expect(
      source,
      'Boundary violation: src/stores/project-canvas.ts must not handle runtime action clear_error; runtime-state ownership belongs to src/stores/hardware-runtime.ts',
    ).not.toContain("case 'clear_error'")

    for (const fieldName of runtimeDomainFields) {
      expect(
        source,
        `Boundary violation: src/stores/project-canvas.ts must not mutate runtime field '${fieldName}'. Runtime domain fields are owned by src/stores/hardware-runtime.ts`,
      ).not.toMatch(makeForbiddenFieldMutationPattern(fieldName))
    }
  })
})
