import { describe, expect, it } from 'vitest'

import {
  buildEditorFileUri,
  normalizeEditorLanguage,
  resolveEditorLanguage,
} from './editor-language'

describe('editor-language', () => {
  it('maps common HDL source and header extensions to Monaco language ids', () => {
    expect(resolveEditorLanguage('top.v')).toBe('verilog')
    expect(resolveEditorLanguage('include.vh')).toBe('verilog')
    expect(resolveEditorLanguage('pipeline.sv')).toBe('systemverilog')
    expect(resolveEditorLanguage('defs.svh')).toBe('systemverilog')
  })

  it('treats file extensions case-insensitively', () => {
    expect(resolveEditorLanguage('Top.V')).toBe('verilog')
    expect(resolveEditorLanguage('Pkg.SVH')).toBe('systemverilog')
  })

  it('falls back to plaintext for unknown files or missing names', () => {
    expect(resolveEditorLanguage('notes.txt')).toBe('plaintext')
    expect(resolveEditorLanguage('rtl.sv.bak')).toBe('plaintext')
    expect(resolveEditorLanguage('')).toBe('plaintext')
    expect(resolveEditorLanguage(null)).toBe('plaintext')
  })

  it('normalizes editor language props before passing them to Monaco', () => {
    expect(normalizeEditorLanguage('verilog')).toBe('verilog')
    expect(normalizeEditorLanguage('systemverilog')).toBe('systemverilog')
    expect(normalizeEditorLanguage('javascript')).toBe('plaintext')
    expect(normalizeEditorLanguage(undefined)).toBe('plaintext')
  })

  it('builds encoded file URIs for relative project paths', () => {
    expect(buildEditorFileUri('file:///tmp/aspen-hdl-lsp', 'rtl/top.sv')).toBe(
      'file:///tmp/aspen-hdl-lsp/rtl/top.sv',
    )
    expect(buildEditorFileUri('file:///tmp/aspen hdl', 'rtl/alu #1.sv')).toBe(
      'file:///tmp/aspen%20hdl/rtl/alu%20%231.sv',
    )
    expect(buildEditorFileUri('file:///tmp/aspen-hdl-lsp/', '中文/模块.sv')).toBe(
      'file:///tmp/aspen-hdl-lsp/%E4%B8%AD%E6%96%87/%E6%A8%A1%E5%9D%97.sv',
    )
  })
})
