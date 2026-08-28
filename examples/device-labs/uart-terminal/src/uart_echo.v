module uart_echo #(
    parameter integer CYCLES_PER_BIT = 16
) (
    input  wire clk,
    input  wire reset,
    input  wire uart_rx,
    output wire uart_tx
);
    reg        rx_busy = 1'b0;
    reg [7:0]  rx_shift = 8'h00;
    reg [3:0]  rx_bit = 0;
    reg [5:0]  rx_count = 0;

    reg        tx_busy = 1'b0;
    reg [9:0]  tx_shift = 10'h3ff;
    reg [3:0]  tx_bit = 0;
    reg [5:0]  tx_count = 0;

    assign uart_tx = tx_busy ? tx_shift[0] : 1'b1;

    always @(posedge clk) begin
        if (reset) begin
            rx_busy <= 1'b0;
            rx_bit <= 0;
            rx_count <= 0;
            tx_busy <= 1'b0;
            tx_shift <= 10'h3ff;
            tx_bit <= 0;
            tx_count <= 0;
        end else begin
            if (!rx_busy) begin
                if (!uart_rx) begin
                    rx_busy <= 1'b1;
                    rx_bit <= 0;
                    rx_count <= CYCLES_PER_BIT + (CYCLES_PER_BIT / 2) - 1;
                end
            end else if (rx_count != 0) begin
                rx_count <= rx_count - 1'b1;
            end else if (rx_bit == 8) begin
                // The complete byte is available after the stop-bit interval.
                rx_busy <= 1'b0;
                if (!tx_busy) begin
                    tx_busy <= 1'b1;
                    tx_shift <= {1'b1, rx_shift, 1'b0};
                    tx_bit <= 0;
                    tx_count <= CYCLES_PER_BIT - 1;
                end
            end else begin
                rx_shift[rx_bit] <= uart_rx;
                rx_count <= CYCLES_PER_BIT - 1;
                if (rx_bit == 7) begin
                    rx_bit <= 8;
                end else begin
                    rx_bit <= rx_bit + 1'b1;
                end
            end

            if (tx_busy) begin
                if (tx_count != 0) begin
                    tx_count <= tx_count - 1'b1;
                end else if (tx_bit == 9) begin
                    tx_busy <= 1'b0;
                end else begin
                    tx_shift <= {1'b1, tx_shift[9:1]};
                    tx_bit <= tx_bit + 1'b1;
                    tx_count <= CYCLES_PER_BIT - 1;
                end
            end
        end
    end
endmodule
