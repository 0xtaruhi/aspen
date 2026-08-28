module keypad_display (
    input  wire       clk,
    input  wire       reset,
    input  wire [3:0] keypad_columns,
    output reg  [3:0] keypad_rows,
    output reg  [7:0] segments
);
    reg [9:0] scan_divider = 0;
    reg [1:0] scan_row = 0;
    reg [3:0] last_key = 0;
    integer column;

    function [7:0] hex_segments;
        input [3:0] hex;
        begin
            case (hex)
                4'h0: hex_segments = 8'h3f; 4'h1: hex_segments = 8'h06;
                4'h2: hex_segments = 8'h5b; 4'h3: hex_segments = 8'h4f;
                4'h4: hex_segments = 8'h66; 4'h5: hex_segments = 8'h6d;
                4'h6: hex_segments = 8'h7d; 4'h7: hex_segments = 8'h07;
                4'h8: hex_segments = 8'h7f; 4'h9: hex_segments = 8'h6f;
                4'hA: hex_segments = 8'h77; 4'hB: hex_segments = 8'h7c;
                4'hC: hex_segments = 8'h39; 4'hD: hex_segments = 8'h5e;
                4'hE: hex_segments = 8'h79; default: hex_segments = 8'h71;
            endcase
        end
    endfunction

    always @(posedge clk) begin
        if (reset) begin
            scan_divider <= 0;
            scan_row <= 0;
            last_key <= 0;
        end else begin
            scan_divider <= scan_divider + 1'b1;
            scan_row <= scan_divider[7:6];
            for (column = 0; column < 4; column = column + 1)
                if (!keypad_columns[column])
                    last_key <= {scan_row, column[1:0]};
        end
    end

    always @* begin
        keypad_rows = 4'b1111;
        keypad_rows[scan_row] = 1'b0;
        segments = hex_segments(last_key);
    end
endmodule
