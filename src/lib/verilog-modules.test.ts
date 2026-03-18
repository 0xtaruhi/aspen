import { describe, expect, it } from 'vitest'

import { extractVerilogModuleNames } from './verilog-modules'

describe('extractVerilogModuleNames', () => {
  it('extracts unique module names and ignores comments', () => {
    const code = `// module ignored_from_comment;
module helper(input wire a, output wire y);
  assign y = a;
endmodule

/* module ignored_from_block_comment; */
module helper(input wire a, output wire y);
  assign y = a;
endmodule

module actual_top(input wire clk, output wire led);
  assign led = clk;
endmodule`

    expect(extractVerilogModuleNames(code)).toEqual(['helper', 'actual_top'])
  })

  it('supports module qualifiers used in SystemVerilog declarations', () => {
    const code = `module automatic actual_top(input logic clk, output logic led);
  assign led = clk;
endmodule

module static helper;
endmodule`

    expect(extractVerilogModuleNames(code)).toEqual(['actual_top', 'helper'])
  })
})
