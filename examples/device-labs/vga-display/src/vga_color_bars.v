module vga_color_bars (
    input  wire       clk,
    output wire       vga_hsync,
    output wire       vga_vsync,
    output reg  [7:0] vga_rgb
);
    localparam H_VISIBLE = 640;
    localparam H_FRONT = 16;
    localparam H_SYNC = 96;
    localparam H_BACK = 48;
    localparam H_TOTAL = H_VISIBLE + H_FRONT + H_SYNC + H_BACK;
    localparam V_VISIBLE = 480;
    localparam V_FRONT = 10;
    localparam V_SYNC = 2;
    localparam V_BACK = 33;
    localparam V_TOTAL = V_VISIBLE + V_FRONT + V_SYNC + V_BACK;

    reg [9:0] x = 0;
    reg [9:0] y = 0;

    always @(posedge clk) begin
        if (x == H_TOTAL - 1) begin
            x <= 0;
            y <= (y == V_TOTAL - 1) ? 0 : y + 1'b1;
        end else begin
            x <= x + 1'b1;
        end
    end

    assign vga_hsync = ~((x >= H_VISIBLE + H_FRONT) && (x < H_VISIBLE + H_FRONT + H_SYNC));
    assign vga_vsync = ~((y >= V_VISIBLE + V_FRONT) && (y < V_VISIBLE + V_FRONT + V_SYNC));

    always @* begin
        if (x >= H_VISIBLE || y >= V_VISIBLE)
            vga_rgb = 8'h00;
        else if (x < 80)
            vga_rgb = 8'b111_111_11;
        else if (x < 160)
            vga_rgb = 8'b111_111_00;
        else if (x < 240)
            vga_rgb = 8'b000_111_11;
        else if (x < 320)
            vga_rgb = 8'b000_111_00;
        else if (x < 400)
            vga_rgb = 8'b111_000_11;
        else if (x < 480)
            vga_rgb = 8'b111_000_00;
        else if (x < 560)
            vga_rgb = 8'b000_000_11;
        else
            vga_rgb = 8'b001_001_00;
    end
endmodule
