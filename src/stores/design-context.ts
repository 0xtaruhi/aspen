import type { SynthesisSourceFileV1 } from '@/lib/hardware-client'
import type { VerilogPort } from '../lib/verilog-parser'

import { computed, ref, watch } from 'vue'

import { extractVerilogModuleNames } from '../lib/verilog-modules'
import { parseVerilogPorts } from '../lib/verilog-parser'
import { projectStore } from './project'
import { collectProjectFileEntries } from './project-tree-files'

export type DesignSource = {
  id: string
  name: string
  path: string
  code: string
  isHardwareSource: boolean
}

export type DesignModuleSource = DesignSource & {
  moduleNames: string[]
}

type SignalSummary = {
  inputs: number
  outputs: number
  inouts: number
}

function isHardwareSourceFile(name: string): boolean {
  return name.endsWith('.v') || name.endsWith('.sv')
}

function collectDesignSources(nodes: typeof projectStore.files): DesignSource[] {
  return collectProjectFileEntries(nodes).map(({ node, path }) => ({
    id: node.id,
    name: node.name,
    path,
    code: node.content || '',
    isHardwareSource: isHardwareSourceFile(node.name),
  }))
}

function toSynthesisSourceFile(source: DesignSource): SynthesisSourceFileV1 {
  return {
    path: source.path,
    content: source.code,
  }
}

const selectedSource = computed<DesignSource | null>(() => {
  const topFile = projectStore.topFile
  if (!topFile || topFile.type !== 'file') {
    return null
  }

  const source = projectSources.value.find((entry) => entry.id === topFile.id)
  if (!source) {
    return null
  }

  return {
    ...source,
  }
})

const sourceName = computed(() => selectedSource.value?.name ?? '')
const sourcePath = computed(() => selectedSource.value?.path ?? '')
const sourceCode = computed(() => selectedSource.value?.code ?? '')
const projectSources = computed(() => collectDesignSources(projectStore.files))
const hardwareSources = computed(() => {
  return projectSources.value.filter((source) => source.isHardwareSource)
})
const projectBuildFiles = computed<SynthesisSourceFileV1[]>(() => {
  return projectSources.value.map((source) => toSynthesisSourceFile(source))
})
const hardwareBuildFiles = computed<SynthesisSourceFileV1[]>(() => {
  return hardwareSources.value.map((source) => toSynthesisSourceFile(source))
})

const moduleSources = computed<DesignModuleSource[]>(() => {
  return hardwareSources.value
    .map((source) => ({
      ...source,
      moduleNames: extractVerilogModuleNames(source.code),
    }))
    .filter((source) => source.moduleNames.length > 0)
})

const parsedModuleNames = computed(() => {
  if (!selectedSource.value?.isHardwareSource) {
    return []
  }

  return extractVerilogModuleNames(sourceCode.value)
})

const lastResolvedModuleNames = ref<string[]>([])
const lastResolvedSourceId = ref<string | null>(null)

watch(
  [
    () => selectedSource.value?.id ?? null,
    () => selectedSource.value?.isHardwareSource ?? false,
    parsedModuleNames,
  ],
  ([sourceId, isHardwareSource, nextModuleNames]) => {
    if (!sourceId || !isHardwareSource) {
      lastResolvedSourceId.value = sourceId
      lastResolvedModuleNames.value = []
      return
    }

    if (sourceId !== lastResolvedSourceId.value) {
      lastResolvedSourceId.value = sourceId
      lastResolvedModuleNames.value = [...nextModuleNames]
      return
    }

    if (nextModuleNames.length > 0) {
      lastResolvedModuleNames.value = [...nextModuleNames]
    }
  },
  { immediate: true },
)

const moduleNames = computed(() => {
  if (!selectedSource.value?.isHardwareSource) {
    return []
  }

  if (parsedModuleNames.value.length > 0) {
    return parsedModuleNames.value
  }

  return lastResolvedModuleNames.value
})

const moduleNamesStale = computed(() => {
  return (
    selectedSource.value?.isHardwareSource === true &&
    parsedModuleNames.value.length === 0 &&
    lastResolvedModuleNames.value.length > 0
  )
})

const primaryModule = computed(() => {
  const explicitTopModule = projectStore.topModuleName.trim()
  if (explicitTopModule && moduleNames.value.includes(explicitTopModule)) {
    return explicitTopModule
  }

  return moduleNames.value[0] || 'top'
})

const codeLines = computed(() => {
  return sourceCode.value
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean).length
})

const signals = computed<readonly VerilogPort[]>(() => {
  if (!selectedSource.value?.isHardwareSource) {
    return []
  }

  return parseVerilogPorts(sourceCode.value).map((signal) => ({
    ...signal,
  }))
})

const signalSummary = computed<SignalSummary>(() => {
  let inputs = 0
  let outputs = 0
  let inouts = 0

  for (const signal of signals.value) {
    if (signal.direction === 'input') {
      inputs += 1
      continue
    }

    if (signal.direction === 'output') {
      outputs += 1
      continue
    }

    if (signal.direction === 'inout') {
      inouts += 1
    }
  }

  return { inputs, outputs, inouts }
})

const outputSignals = computed(() => {
  return signals.value.filter((signal) => signal.direction === 'output')
})

export const designContextStore = {
  selectedSource,
  sourceName,
  sourcePath,
  sourceCode,
  projectSources,
  hardwareSources,
  projectBuildFiles,
  hardwareBuildFiles,
  moduleSources,
  moduleNames,
  moduleNamesStale,
  primaryModule,
  codeLines,
  signals,
  signalSummary,
  outputSignals,
}
