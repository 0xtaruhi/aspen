import type { SynthesisSourceFileV1 } from '@/lib/hardware-client'

export function buildSynthesisInputSignature(
  topModule: string,
  files: readonly SynthesisSourceFileV1[],
): string {
  return JSON.stringify({
    topModule,
    files: files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  })
}
