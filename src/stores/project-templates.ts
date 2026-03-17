import type { ProjectNode } from './project-model'

export type ProjectTemplate = 'empty' | 'blinky' | 'uart'

export type ProjectTemplateState = {
  files: ProjectNode[]
  activeFileId: string
  selectedNodeId: string
  topFileId: string
  topModuleName: string
}

function createRootNode(name: string): ProjectNode {
  return {
    id: 'root',
    name: name || 'src',
    type: 'folder',
    isOpen: true,
    children: [],
  }
}

export function createProjectTemplateState(
  name: string,
  template: ProjectTemplate,
): ProjectTemplateState {
  const files = [createRootNode(name)]

  if (template === 'blinky') {
    files[0].children?.push({
      id: '1',
      name: 'blinky.v',
      type: 'file',
      content: `module blinky(
    input clk,
    output reg led
);
    reg [25:0] count;
    always @(posedge clk) begin
        count <= count + 1;
        if (count == 0) led <= ~led;
    end
endmodule`,
    })

    return {
      files,
      activeFileId: '1',
      selectedNodeId: '1',
      topFileId: '1',
      topModuleName: 'blinky',
    }
  }

  if (template === 'uart') {
    files[0].children?.push({
      id: '1',
      name: 'uart_tx.v',
      type: 'file',
      content: `module uart_tx #(
    parameter CLK_FREQ = 50_000_000,
    parameter BAUD_RATE = 115_200
)(
    input wire clk,
    input wire rst,
    input wire tx_start,
    input wire [7:0] tx_data,
    output reg tx,
    output reg busy
);
    localparam integer CLKS_PER_BIT = CLK_FREQ / BAUD_RATE;
    reg [15:0] clk_count;
    reg [3:0] bit_index;
    reg [9:0] shift_reg;

    always @(posedge clk) begin
        if (rst) begin
            tx <= 1'b1;
            busy <= 1'b0;
            clk_count <= 0;
            bit_index <= 0;
            shift_reg <= 10'b1111111111;
        end else if (!busy && tx_start) begin
            busy <= 1'b1;
            shift_reg <= {1'b1, tx_data, 1'b0};
            clk_count <= 0;
            bit_index <= 0;
        end else if (busy) begin
            if (clk_count == CLKS_PER_BIT - 1) begin
                clk_count <= 0;
                tx <= shift_reg[0];
                shift_reg <= {1'b1, shift_reg[9:1]};
                bit_index <= bit_index + 1;
                if (bit_index == 9) begin
                    busy <= 1'b0;
                end
            end else begin
                clk_count <= clk_count + 1;
            end
        end
    end
endmodule`,
    })

    return {
      files,
      activeFileId: '1',
      selectedNodeId: '1',
      topFileId: '1',
      topModuleName: 'uart_tx',
    }
  }

  return {
    files,
    activeFileId: '',
    selectedNodeId: '',
    topFileId: '',
    topModuleName: '',
  }
}
