module encoder_position (
    input  wire       clk,
    input  wire       encoder_a,
    input  wire       encoder_b,
    input  wire       encoder_button,
    output reg  [7:0] segments
);
    reg [1:0] previous_ab = 0;
    reg [3:0] position = 0;
    wire [1:0] current_ab = {encoder_a, encoder_b};

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
        previous_ab <= current_ab;
        if (encoder_button) begin
            position <= 0;
        end else begin
            case ({previous_ab, current_ab})
                4'b0001, 4'b0111, 4'b1110, 4'b1000: position <= position + 1'b1;
                4'b0010, 4'b1011, 4'b1101, 4'b0100: position <= position - 1'b1;
                default: position <= position;
            endcase
        end
    end

    always @* segments = hex_segments(position);
endmodule
