import type { MessageKey } from '@/lib/i18n'
import type { ProjectSnapshot } from '@/stores/project'
import type { ProjectTemplate } from '@/stores/project-templates'

import { normalizeProjectSnapshot } from '@/stores/project-model'
import { projectStore } from '@/stores/project'

export type ProjectExampleId =
  | 'device-labs/gpio-controls'
  | 'device-labs/segment-counter'
  | 'device-labs/led-matrix'
  | 'device-labs/uart-terminal'
  | 'device-labs/hd44780-lcd'
  | 'device-labs/matrix-keypad'
  | 'device-labs/quadrature-encoder'
  | 'device-labs/audio-pwm'
  | 'device-labs/vga-display'
  | 'showcases/keypad-calculator'
  | 'showcases/mini-synth'
  | 'showcases/vga-pong'

export type ProjectStarter =
  { kind: 'template'; template: ProjectTemplate } | { kind: 'example'; exampleId: ProjectExampleId }

export type ProjectStarterCategory = 'template' | 'device-lab' | 'showcase'

export type ProjectStarterCatalogEntry = {
  id: string
  category: ProjectStarterCategory
  titleKey: MessageKey
  descriptionKey: MessageKey
  suggestedName: string
  starter: ProjectStarter
}

type DirectoryProjectMetadata = Omit<ProjectSnapshot, 'version'> & {
  version: 3
  layout: 'directory'
}

const bundledExampleFiles = import.meta.glob('../../examples/{device-labs,showcases}/**/*', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

export const projectStarterCatalog: ProjectStarterCatalogEntry[] = [
  {
    id: 'template-empty',
    category: 'template',
    titleKey: 'emptyProject',
    descriptionKey: 'emptyProjectDescription',
    suggestedName: 'MyFPGAProject',
    starter: { kind: 'template', template: 'empty' },
  },
  {
    id: 'template-blinky',
    category: 'template',
    titleKey: 'ledBlinky',
    descriptionKey: 'ledBlinkyDescription',
    suggestedName: 'Blinky',
    starter: { kind: 'template', template: 'blinky' },
  },
  {
    id: 'template-uart',
    category: 'template',
    titleKey: 'uartEcho',
    descriptionKey: 'uartStarterDescription',
    suggestedName: 'UartTx',
    starter: { kind: 'template', template: 'uart' },
  },
  {
    id: 'example-gpio-controls',
    category: 'device-lab',
    titleKey: 'gpioControlsLab',
    descriptionKey: 'gpioControlsLabDescription',
    suggestedName: 'GPIOControlsLab',
    starter: { kind: 'example', exampleId: 'device-labs/gpio-controls' },
  },
  {
    id: 'example-segment-counter',
    category: 'device-lab',
    titleKey: 'segmentCounterLab',
    descriptionKey: 'segmentCounterLabDescription',
    suggestedName: 'SegmentCounterLab',
    starter: { kind: 'example', exampleId: 'device-labs/segment-counter' },
  },
  {
    id: 'example-led-matrix',
    category: 'device-lab',
    titleKey: 'ledMatrixLab',
    descriptionKey: 'ledMatrixLabDescription',
    suggestedName: 'LedMatrixLab',
    starter: { kind: 'example', exampleId: 'device-labs/led-matrix' },
  },
  {
    id: 'example-uart-terminal',
    category: 'device-lab',
    titleKey: 'uartTerminalLab',
    descriptionKey: 'uartTerminalLabDescription',
    suggestedName: 'UartTerminalLab',
    starter: { kind: 'example', exampleId: 'device-labs/uart-terminal' },
  },
  {
    id: 'example-hd44780-lcd',
    category: 'device-lab',
    titleKey: 'hd44780LcdLab',
    descriptionKey: 'hd44780LcdLabDescription',
    suggestedName: 'Hd44780LcdLab',
    starter: { kind: 'example', exampleId: 'device-labs/hd44780-lcd' },
  },
  {
    id: 'example-matrix-keypad',
    category: 'device-lab',
    titleKey: 'matrixKeypadLab',
    descriptionKey: 'matrixKeypadLabDescription',
    suggestedName: 'MatrixKeypadLab',
    starter: { kind: 'example', exampleId: 'device-labs/matrix-keypad' },
  },
  {
    id: 'example-quadrature-encoder',
    category: 'device-lab',
    titleKey: 'quadratureEncoderLab',
    descriptionKey: 'quadratureEncoderLabDescription',
    suggestedName: 'QuadratureEncoderLab',
    starter: { kind: 'example', exampleId: 'device-labs/quadrature-encoder' },
  },
  {
    id: 'example-audio-pwm',
    category: 'device-lab',
    titleKey: 'audioPwmLab',
    descriptionKey: 'audioPwmLabDescription',
    suggestedName: 'AudioPwmLab',
    starter: { kind: 'example', exampleId: 'device-labs/audio-pwm' },
  },
  {
    id: 'example-vga-display',
    category: 'device-lab',
    titleKey: 'vgaDisplayLab',
    descriptionKey: 'vgaDisplayLabDescription',
    suggestedName: 'VgaDisplayLab',
    starter: { kind: 'example', exampleId: 'device-labs/vga-display' },
  },
  {
    id: 'example-keypad-calculator',
    category: 'showcase',
    titleKey: 'keypadCalculator',
    descriptionKey: 'keypadCalculatorDescription',
    suggestedName: 'KeypadCalculator',
    starter: { kind: 'example', exampleId: 'showcases/keypad-calculator' },
  },
  {
    id: 'example-mini-synth',
    category: 'showcase',
    titleKey: 'miniSynth',
    descriptionKey: 'miniSynthDescription',
    suggestedName: 'MiniSynth',
    starter: { kind: 'example', exampleId: 'showcases/mini-synth' },
  },
  {
    id: 'example-vga-pong',
    category: 'showcase',
    titleKey: 'vgaPong',
    descriptionKey: 'vgaPongDescription',
    suggestedName: 'VgaPong',
    starter: { kind: 'example', exampleId: 'showcases/vga-pong' },
  },
]

export const defaultProjectStarter = projectStarterCatalog[0]

function joinRelativePath(...parts: string[]) {
  return parts.filter(Boolean).join('/')
}

function hydrateMetadataNode(
  node: ProjectSnapshot['content']['files'][number],
  exampleRoot: string,
  relativeDirectory = '',
  isProjectRoot = false,
): ProjectSnapshot['content']['files'][number] {
  if (node.type === 'file') {
    const sourcePath = `${exampleRoot}/src/${joinRelativePath(relativeDirectory, node.name)}`
    const content = bundledExampleFiles[sourcePath]
    if (typeof content !== 'string') {
      throw new Error(`Bundled example source is missing: ${sourcePath}`)
    }

    return { ...node, content }
  }

  const childDirectory = isProjectRoot
    ? relativeDirectory
    : joinRelativePath(relativeDirectory, node.name)
  return {
    ...node,
    children: (node.children ?? []).map((child) =>
      hydrateMetadataNode(child, exampleRoot, childDirectory),
    ),
  }
}

export function createBundledExampleSnapshot(
  exampleId: ProjectExampleId,
  projectName: string,
): ProjectSnapshot {
  const exampleRoot = `../../examples/${exampleId}`
  const metadataSource = bundledExampleFiles[`${exampleRoot}/aspen.project.json`]
  if (typeof metadataSource !== 'string') {
    throw new Error(`Bundled example metadata is missing: ${exampleId}`)
  }

  const metadata = JSON.parse(metadataSource) as DirectoryProjectMetadata
  if (metadata.version !== 3 || metadata.layout !== 'directory') {
    throw new Error(`Bundled example metadata is invalid: ${exampleId}`)
  }

  const files = metadata.content.files.map((node, index) =>
    hydrateMetadataNode(node, exampleRoot, '', index === 0),
  )
  if (files[0]?.type === 'folder') {
    files[0].name = projectName
  }

  return normalizeProjectSnapshot({
    version: 2,
    content: {
      ...metadata.content,
      name: projectName,
      files,
      synthesisCache: null,
      implementationCache: null,
    },
    workspaceView: metadata.workspaceView,
  })
}

export function initializeProjectFromStarter(projectName: string, starter: ProjectStarter) {
  if (starter.kind === 'template') {
    projectStore.createNewProject(projectName, starter.template)
    return
  }

  projectStore.loadFromSnapshot(createBundledExampleSnapshot(starter.exampleId, projectName))
}
