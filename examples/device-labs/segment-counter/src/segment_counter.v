module segment_counter (
    input  wire       clk,
    input  wire       reset,
    output reg  [7:0] segments,
    output reg  [3:0] digit_select
);
    reg [23:0] tick = 0;
    reg [15:0] value = 16'h0000;
    reg [1:0] scan_digit = 0;
    reg [3:0] nibble;

    function [7:0] hex_segments;
        input [3:0] hex;
        begin
            case (hex)
                4'h0: hex_segments = 8'b00111111;
                4'h1: hex_segments = 8'b00000110;
                4'h2: hex_segments = 8'b01011011;
                4'h3: hex_segments = 8'b01001111;
                4'h4: hex_segments = 8'b01100110;
                4'h5: hex_segments = 8'b01101101;
                4'h6: hex_segments = 8'b01111101;
                4'h7: hex_segments = 8'b00000111;
                4'h8: hex_segments = 8'b01111111;
                4'h9: hex_segments = 8'b01101111;
                4'hA: hex_segments = 8'b01110111;
                4'hB: hex_segments = 8'b01111100;
                4'hC: hex_segments = 8'b00111001;
                4'hD: hex_segments = 8'b01011110;
                4'hE: hex_segments = 8'b01111001;
                default: hex_segments = 8'b01110001;
            endcase
        end
    endfunction

    always @(posedge clk) begin
        if (reset) begin
            tick <= 0;
            value <= 0;
            scan_digit <= 0;
        end else begin
            scan_digit <= tick[8:7];
            if (tick == 24'd2_999_999) begin
                tick <= 0;
                value <= value + 1'b1;
            end else begin
                tick <= tick + 1'b1;
            end
        end
    end

    always @* begin
        digit_select = 4'b0001 << scan_digit;
        case (scan_digit)
            2'd0: nibble = value[3:0];
            2'd1: nibble = value[7:4];
            2'd2: nibble = value[11:8];
            default: nibble = value[15:12];
        endcase
        segments = hex_segments(nibble);
    end
endmodule
