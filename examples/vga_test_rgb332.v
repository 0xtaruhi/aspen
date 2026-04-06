module vga_test_rgb332(
    input  wire clk,
    output wire hsync,
    output wire vsync,
    output reg  [7:0] rgb
);
    // Assumes clk = 25 MHz for 640x480@60 VGA timing.
    // In Aspen:
    //   - Add a VGA display virtual device
    //   - Set resolution to 640x480
    //   - Set color mode to RGB332
    //   - Bind hsync / vsync / rgb

    localparam H_VISIBLE = 640;
    localparam H_FRONT   = 16;
    localparam H_SYNC    = 96;
    localparam H_BACK    = 48;
    localparam H_TOTAL   = H_VISIBLE + H_FRONT + H_SYNC + H_BACK;

    localparam V_VISIBLE = 480;
    localparam V_FRONT   = 10;
    localparam V_SYNC    = 2;
    localparam V_BACK    = 33;
    localparam V_TOTAL   = V_VISIBLE + V_FRONT + V_SYNC + V_BACK;

    reg [9:0] hcnt = 0;
    reg [9:0] vcnt = 0;

    wire visible;
    wire [9:0] x;
    wire [9:0] y;

    always @(posedge clk) begin
        if (hcnt == H_TOTAL - 1) begin
            hcnt <= 0;
            if (vcnt == V_TOTAL - 1)
                vcnt <= 0;
            else
                vcnt <= vcnt + 1;
        end else begin
            hcnt <= hcnt + 1;
        end
    end

    assign hsync = ~((hcnt >= H_VISIBLE + H_FRONT) && (hcnt < H_VISIBLE + H_FRONT + H_SYNC));
    assign vsync = ~((vcnt >= V_VISIBLE + V_FRONT) && (vcnt < V_VISIBLE + V_FRONT + V_SYNC));

    assign visible = (hcnt < H_VISIBLE) && (vcnt < V_VISIBLE);
    assign x = hcnt;
    assign y = vcnt;

    always @(posedge clk) begin
        if (!visible) begin
            rgb <= 8'h00;
        end else if (y < 80) begin
            rgb <= 8'b111_000_00; // red
        end else if (y < 160) begin
            rgb <= 8'b000_111_00; // green
        end else if (y < 240) begin
            rgb <= 8'b000_000_11; // blue
        end else if (y < 320) begin
            rgb <= {x[7:5], y[7:5], x[6:5]}; // gradient-ish pattern
        end else if (y < 400) begin
            rgb <= x[5] ? 8'hFF : 8'h00; // vertical stripes
        end else begin
            // moving white square on dark background
            if ((x >= {2'b00, vcnt[7:0]}) && (x < {2'b00, vcnt[7:0]} + 64) &&
                (y >= 400) && (y < 464))
                rgb <= 8'hFF;
            else
                rgb <= 8'h12;
        end
    end
endmodule
