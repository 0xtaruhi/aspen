export type EditorLanguage = 'plaintext' | 'verilog' | 'systemverilog'

const HDL_EXTENSION_LANGUAGE_MAP: Array<[extension: string, language: EditorLanguage]> = [
  ['.svh', 'systemverilog'],
  ['.sv', 'systemverilog'],
  ['.vh', 'verilog'],
  ['.v', 'verilog'],
]

export function normalizeEditorLanguage(language?: string | null): EditorLanguage {
  if (language === 'verilog' || language === 'systemverilog') {
    return language
  }

  return 'plaintext'
}

export function resolveEditorLanguage(fileName?: string | null): EditorLanguage {
  const normalizedFileName = fileName?.trim().toLowerCase() ?? ''
  if (!normalizedFileName) {
    return 'plaintext'
  }

  for (const [extension, language] of HDL_EXTENSION_LANGUAGE_MAP) {
    if (normalizedFileName.endsWith(extension)) {
      return language
    }
  }

  return 'plaintext'
}
