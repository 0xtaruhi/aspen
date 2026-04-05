import type { SynthesisSourceFileV1 } from '@/lib/hardware-client'

export function buildImplementationInputSignature(
  topModule: string,
  targetDeviceId: string,
  constraintXml: string,
  placeMode: string,
  files: readonly SynthesisSourceFileV1[],
): string {
  return JSON.stringify({
    topModule,
    targetDeviceId,
    constraintXml,
    placeMode,
    files: files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  })
}
