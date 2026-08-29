module led_matrix_demo (
    input  wire       clk,
    input  wire       reset,
    output reg  [7:0] matrix_rows,
    output reg  [7:0] matrix_columns
);
    reg [19:0] divider = 0;
    reg [2:0] scan_row = 0;
    reg [2:0] animation = 0;
    reg [7:0] pixels;

    always @(posedge clk) begin
        if (reset) begin
            divider <= 0;
            scan_row <= 0;
            animation <= 0;
        end else begin
            divider <= divider + 1'b1;
            scan_row <= divider[8:6];
            if (divider == 20'd999_999)
                animation <= animation + 1'b1;
        end
    end

    always @* begin
        matrix_rows = 8'b00000001 << scan_row;
        pixels = (8'b00011000 << animation) | (8'b00011000 >> (8 - animation));
        matrix_columns = pixels ^ (8'b00000001 << scan_row);
    end
endmodule
