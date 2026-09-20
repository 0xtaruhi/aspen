module hd44780_hello (
    input  wire       clk,
    input  wire       reset,
    output reg        lcd_rs,
    output wire       lcd_rw,
    output reg        lcd_e,
    output reg  [3:0] lcd_data
);
    localparam POWER_WAIT = 4'd0;
    localparam INIT_SETUP = 4'd1;
    localparam INIT_HIGH = 4'd2;
    localparam INIT_LOW = 4'd3;
    localparam INIT_GAP = 4'd4;
    localparam BYTE_SETUP = 4'd5;
    localparam BYTE_HIGH = 4'd6;
    localparam BYTE_LOW = 4'd7;
    localparam BYTE_GAP = 4'd8;
    localparam DONE = 4'd9;

    localparam [5:0] LAST_BYTE = 6'd35;

    reg [3:0] state = POWER_WAIT;
    reg [3:0] phase_count = 0;
    reg [19:0] wait_count = 0;
    reg [19:0] wait_limit = 0;
    reg [1:0] init_index = 0;
    reg [5:0] byte_index = 0;
    reg low_nibble = 1'b0;

    wire [7:0] current_byte = text_byte(byte_index);

    assign lcd_rw = 1'b0;

    function byte_is_data;
        input [5:0] index;
        begin
            byte_is_data = (index >= 6'd5 && index <= 6'd20) || index >= 6'd22;
        end
    endfunction

    function [7:0] text_byte;
        input [5:0] index;
        begin
            case (index)
                0: text_byte = 8'h28; // 4-bit, 2-line function set
                1: text_byte = 8'h0c; // display on, cursor off
                2: text_byte = 8'h06; // increment cursor
                3: text_byte = 8'h01; // clear display
                4: text_byte = 8'h80; // first line
                5: text_byte = "A";  6: text_byte = "S";
                7: text_byte = "P";  8: text_byte = "E";
                9: text_byte = "N"; 10: text_byte = " ";
                11: text_byte = "D"; 12: text_byte = "E";
                13: text_byte = "V"; 14: text_byte = "I";
                15: text_byte = "C"; 16: text_byte = "E";
                17: text_byte = " "; 18: text_byte = "L";
                19: text_byte = "A"; 20: text_byte = "B";
                21: text_byte = 8'hc0; // second line
                22: text_byte = "V"; 23: text_byte = "I";
                24: text_byte = "R"; 25: text_byte = "T";
                26: text_byte = "U"; 27: text_byte = "A";
                28: text_byte = "L"; 29: text_byte = " ";
                30: text_byte = "L"; 31: text_byte = "C";
                32: text_byte = "D"; 33: text_byte = " ";
                34: text_byte = "O"; 35: text_byte = "K";
                default: text_byte = " ";
            endcase
        end
    endfunction

    always @(posedge clk) begin
        if (reset) begin
            state <= POWER_WAIT;
            phase_count <= 0;
            wait_count <= 0;
            wait_limit <= 0;
            init_index <= 0;
            byte_index <= 0;
            low_nibble <= 1'b0;
            lcd_rs <= 1'b0;
            lcd_e <= 1'b0;
            lcd_data <= 4'h0;
        end else begin
            case (state)
                POWER_WAIT: begin
                    // Wait 15 ms after power-up at the 30 MHz fabric clock.
                    if (wait_count == 20'd449_999) begin
                        wait_count <= 0;
                        phase_count <= 0;
                        lcd_data <= 4'h3;
                        state <= INIT_SETUP;
                    end else begin
                        wait_count <= wait_count + 1'b1;
                    end
                end
                INIT_SETUP: begin
                    if (phase_count == 4'd15) begin
                        phase_count <= 0;
                        lcd_e <= 1'b1;
                        state <= INIT_HIGH;
                    end else begin
                        phase_count <= phase_count + 1'b1;
                    end
                end
                INIT_HIGH: begin
                    if (phase_count == 4'd15) begin
                        phase_count <= 0;
                        lcd_e <= 1'b0;
                        state <= INIT_LOW;
                    end else begin
                        phase_count <= phase_count + 1'b1;
                    end
                end
                INIT_LOW: begin
                    if (phase_count == 4'd15) begin
                        phase_count <= 0;
                        wait_count <= 0;
                        if (init_index == 0)
                            wait_limit <= 20'd122_999; // 4.1 ms
                        else if (init_index == 3)
                            wait_limit <= 20'd1_199; // 40 us
                        else
                            wait_limit <= 20'd2_999; // 100 us
                        state <= INIT_GAP;
                    end else begin
                        phase_count <= phase_count + 1'b1;
                    end
                end
                INIT_GAP: begin
                    if (wait_count == wait_limit) begin
                        wait_count <= 0;
                        if (init_index == 3) begin
                            byte_index <= 0;
                            low_nibble <= 1'b0;
                            lcd_rs <= 1'b0;
                            lcd_data <= text_byte(0) >> 4;
                            state <= BYTE_SETUP;
                        end else begin
                            init_index <= init_index + 1'b1;
                            lcd_data <= (init_index == 2) ? 4'h2 : 4'h3;
                            state <= INIT_SETUP;
                        end
                    end else begin
                        wait_count <= wait_count + 1'b1;
                    end
                end
                BYTE_SETUP: begin
                    if (phase_count == 4'd15) begin
                        phase_count <= 0;
                        lcd_e <= 1'b1;
                        state <= BYTE_HIGH;
                    end else begin
                        phase_count <= phase_count + 1'b1;
                    end
                end
                BYTE_HIGH: begin
                    if (phase_count == 4'd15) begin
                        phase_count <= 0;
                        lcd_e <= 1'b0;
                        state <= BYTE_LOW;
                    end else begin
                        phase_count <= phase_count + 1'b1;
                    end
                end
                BYTE_LOW: begin
                    if (phase_count == 4'd15) begin
                        phase_count <= 0;
                        if (!low_nibble) begin
                            low_nibble <= 1'b1;
                            lcd_data <= current_byte[3:0];
                            state <= BYTE_SETUP;
                        end else begin
                            low_nibble <= 1'b0;
                            wait_count <= 0;
                            wait_limit <= (byte_index == 3) ? 20'd59_999 : 20'd1_199;
                            state <= BYTE_GAP;
                        end
                    end else begin
                        phase_count <= phase_count + 1'b1;
                    end
                end
                BYTE_GAP: begin
                    if (wait_count == wait_limit) begin
                        wait_count <= 0;
                        if (byte_index == LAST_BYTE) begin
                            state <= DONE;
                        end else begin
                            byte_index <= byte_index + 1'b1;
                            lcd_rs <= byte_is_data(byte_index + 1'b1);
                            lcd_data <= text_byte(byte_index + 1'b1) >> 4;
                            state <= BYTE_SETUP;
                        end
                    end else begin
                        wait_count <= wait_count + 1'b1;
                    end
                end
                default: begin
                    lcd_e <= 1'b0;
                    state <= DONE;
                end
            endcase
        end
    end
endmodule
