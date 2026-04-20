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

export function normalizeEditorPath(path?: string | null): string {
  return (path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('/')
}

export function buildEditorFileUri(rootUri: string, relativePath: string): string {
  const normalizedRoot = rootUri.replace(/\/+$/, '')
  const normalizedPath = normalizeEditorPath(relativePath)

  return normalizedPath ? `${normalizedRoot}/${normalizedPath}` : normalizedRoot
}
