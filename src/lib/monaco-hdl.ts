import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'

import 'monaco-editor/esm/vs/basic-languages/systemverilog/systemverilog.contribution'

const HDL_LANGUAGE_IDS = ['verilog', 'systemverilog'] as const

type HdlLanguageId = (typeof HDL_LANGUAGE_IDS)[number]

type HdlSnippet = {
  label: string
  detail: string
  documentation: string
  insertText: string
}

const COMMON_SNIPPETS: HdlSnippet[] = [
  {
    label: 'module',
    detail: 'Module declaration',
    documentation: 'Create a module skeleton with a port list and body.',
    insertText: [
      'module ${1:module_name} (',
      '  ${2:// ports}',
      ');',
      '',
      '  $0',
      '',
      'endmodule',
    ].join('\n'),
  },
  {
    label: 'always',
    detail: 'Sequential block',
    documentation: 'Create an always block with a sensitivity list.',
    insertText: ['always @(${1:*}) begin', '  $0', 'end'].join('\n'),
  },
  {
    label: 'initial',
    detail: 'Initial block',
    documentation: 'Create an initial block.',
    insertText: ['initial begin', '  $0', 'end'].join('\n'),
  },
  {
    label: 'case',
    detail: 'Case statement',
    documentation: 'Create a case statement with a default branch.',
    insertText: [
      'case (${1:expr})',
      '  ${2:value}: begin',
      '    $0',
      '  end',
      '  default: begin',
      '  end',
      'endcase',
    ].join('\n'),
  },
  {
    label: 'tb',
    detail: 'Testbench scaffold',
    documentation: 'Create a basic simulation scaffold for a DUT instance.',
    insertText: [
      '`timescale 1ns/1ps',
      '',
      'module ${1:module_name}_tb;',
      '  ${2:// stimulus}',
      '',
      '  ${3:module_name} dut (',
      '    ${4:// connections}',
      '  );',
      '',
      '  initial begin',
      '    $0',
      '  end',
      'endmodule',
    ].join('\n'),
  },
]

const SYSTEMVERILOG_SNIPPETS: HdlSnippet[] = [
  {
    label: 'always_comb',
    detail: 'Combinational block',
    documentation: 'Create a synthesizable SystemVerilog combinational block.',
    insertText: ['always_comb begin', '  $0', 'end'].join('\n'),
  },
  {
    label: 'always_ff',
    detail: 'Flip-flop block',
    documentation: 'Create a clocked SystemVerilog sequential block.',
    insertText: [
      'always_ff @(posedge ${1:clk}${2: or negedge rst_n}) begin',
      '  if (!rst_n) begin',
      '    ${3:// reset state}',
      '  end else begin',
      '    $0',
      '  end',
      'end',
    ].join('\n'),
  },
  {
    label: 'always_latch',
    detail: 'Latch block',
    documentation: 'Create a SystemVerilog latch block.',
    insertText: ['always_latch begin', '  $0', 'end'].join('\n'),
  },
  {
    label: 'typedef_enum',
    detail: 'Typed enum',
    documentation: 'Create a typed SystemVerilog enum declaration.',
    insertText: [
      'typedef enum logic [${1:1}:0] {',
      '  ${2:IDLE},',
      '  ${3:BUSY}',
      '} ${4:state_t};',
      '',
      '$0',
    ].join('\n'),
  },
]

type MonacoGlobal = typeof globalThis & {
  __aspenMonacoHdlSupportRegistered?: boolean
}

function buildSnippetSuggestions(
  monaco: typeof Monaco,
  snippets: HdlSnippet[],
  range: Monaco.IRange,
): Monaco.languages.CompletionItem[] {
  return snippets.map((snippet, index) => ({
    label: snippet.label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: snippet.insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: snippet.documentation,
    detail: snippet.detail,
    range,
    sortText: `0${index.toString().padStart(2, '0')}`,
  }))
}

function registerSnippetProvider(
  monaco: typeof Monaco,
  language: HdlLanguageId,
  snippets: HdlSnippet[],
) {
  monaco.languages.registerCompletionItemProvider(language, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      return {
        suggestions: buildSnippetSuggestions(monaco, snippets, range),
      }
    },
  })
}

export function ensureMonacoHdlSupport(monaco: typeof Monaco) {
  const monacoGlobal = globalThis as MonacoGlobal
  if (monacoGlobal.__aspenMonacoHdlSupportRegistered) {
    return
  }

  monacoGlobal.__aspenMonacoHdlSupportRegistered = true

  for (const language of HDL_LANGUAGE_IDS) {
    registerSnippetProvider(monaco, language, COMMON_SNIPPETS)
  }

  registerSnippetProvider(monaco, 'systemverilog', SYSTEMVERILOG_SNIPPETS)
}
