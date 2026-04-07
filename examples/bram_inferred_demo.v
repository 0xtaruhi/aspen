module bram_inferred_demo(
    input wire clk,
    input wire we,
    input wire [7:0] addr,
    input wire [15:0] din,
    output reg [15:0] dout
);
    reg [15:0] mem [0:255];

    initial begin
        $readmemh("bram_inferred_init.mem", mem);
    end

    always @(posedge clk) begin
        if (we)
            mem[addr] <= din;
        dout <= mem[addr];
    end
endmodule
