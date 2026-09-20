// HD44780-compatible 16x2 LCD controller for Aspen's 8-bit LCD device.
//
// The controller initializes the LCD, writes two complete 16-character rows,
// and alternates between two generic demo pages. Character data uses ordinary
// ASCII bytes.
//
// CLK_HZ must be equal to or greater than the actual runtime clock frequency.
// The 1.6 MHz default matches Aspen's current VLFD operating range; running
// the design at a lower frequency only lengthens the LCD timing margins.
module hd44780_hello #(
    parameter integer CLK_HZ       = 1_600_000,
    parameter integer PAGE_HOLD_MS = 2_000
) (
    input  wire       clk,
    input  wire       reset,
    output reg        lcd_rs,
    output wire       lcd_rw,
    output reg        lcd_e,
    output reg  [7:0] lcd_data
);
    localparam integer CYCLES_PER_US = (CLK_HZ + 999_999) / 1_000_000;
    localparam integer CYCLES_PER_MS = (CLK_HZ + 999) / 1_000;

    localparam integer POWER_WAIT_CYCLES = 20_000 * CYCLES_PER_US;
    localparam integer SETUP_CYCLES      = CYCLES_PER_US;
    localparam integer ENABLE_CYCLES     = CYCLES_PER_US;
    localparam integer COMMAND_CYCLES    = 50 * CYCLES_PER_US;
    localparam integer CLEAR_CYCLES      = 2_000 * CYCLES_PER_US;
    localparam integer PAGE_HOLD_CYCLES  = PAGE_HOLD_MS * CYCLES_PER_MS;

    localparam [3:0] ST_POWER_WAIT  = 4'd0;
    localparam [3:0] ST_LOAD        = 4'd1;
    localparam [3:0] ST_SETUP       = 4'd2;
    localparam [3:0] ST_ENABLE      = 4'd3;
    localparam [3:0] ST_COMMAND_GAP = 4'd4;
    localparam [3:0] ST_PAGE_HOLD   = 4'd5;

    localparam MODE_INIT = 1'b0;
    localparam MODE_PAGE = 1'b1;

    reg [3:0]  state;
    reg        mode;
    reg        page_select;
    reg [2:0]  init_index;
    reg [5:0]  page_index;
    reg [31:0] timer;
    reg [31:0] command_wait_cycles;

    // Aspen's HD44780 observer models write transactions only.
    assign lcd_rw = 1'b0;

    function [7:0] page_char;
        input       selected_page;
        input [4:0] char_index;
        begin
            if (!selected_page) begin
                case (char_index)
                    5'd0:  page_char = "*";
                    5'd1:  page_char = "*";
                    5'd2:  page_char = " ";
                    5'd3:  page_char = "W";
                    5'd4:  page_char = "e";
                    5'd5:  page_char = "l";
                    5'd6:  page_char = "c";
                    5'd7:  page_char = "o";
                    5'd8:  page_char = "m";
                    5'd9:  page_char = "e";
                    5'd10: page_char = " ";
                    5'd11: page_char = "T";
                    5'd12: page_char = "o";
                    5'd13: page_char = " ";
                    5'd14: page_char = "*";
                    5'd15: page_char = "*";
                    5'd16: page_char = "A";
                    5'd17: page_char = "s";
                    5'd18: page_char = "p";
                    5'd19: page_char = "e";
                    5'd20: page_char = "n";
                    5'd21: page_char = " ";
                    5'd22: page_char = "H";
                    5'd23: page_char = "D";
                    5'd24: page_char = "4";
                    5'd25: page_char = "4";
                    5'd26: page_char = "7";
                    5'd27: page_char = "8";
                    5'd28: page_char = "0";
                    5'd29, 5'd30, 5'd31: page_char = " ";
                    default: page_char = " ";
                endcase
            end else begin
                case (char_index)
                    5'd0:  page_char = " ";
                    5'd1:  page_char = "E";
                    5'd2:  page_char = "x";
                    5'd3:  page_char = "a";
                    5'd4:  page_char = "m";
                    5'd5:  page_char = "p";
                    5'd6:  page_char = "l";
                    5'd7:  page_char = "e";
                    5'd8:  page_char = " ";
                    5'd9:  page_char = "P";
                    5'd10: page_char = "r";
                    5'd11: page_char = "o";
                    5'd12: page_char = "j";
                    5'd13: page_char = "e";
                    5'd14: page_char = "c";
                    5'd15: page_char = "t";
                    5'd16, 5'd17, 5'd18: page_char = " ";
                    5'd19: page_char = "D";
                    5'd20: page_char = "e";
                    5'd21: page_char = "m";
                    5'd22: page_char = "o";
                    5'd23: page_char = " ";
                    5'd24: page_char = "R";
                    5'd25: page_char = "e";
                    5'd26: page_char = "a";
                    5'd27: page_char = "d";
                    5'd28: page_char = "y";
                    5'd29, 5'd30, 5'd31: page_char = " ";
                    default: page_char = " ";
                endcase
            end
        end
    endfunction

    always @(posedge clk or posedge reset) begin
        if (reset) begin
            state               <= ST_POWER_WAIT;
            mode                <= MODE_INIT;
            page_select         <= 1'b0;
            init_index          <= 3'd0;
            page_index          <= 6'd0;
            timer               <= 32'd0;
            command_wait_cycles <= COMMAND_CYCLES;
            lcd_e               <= 1'b0;
            lcd_rs              <= 1'b0;
            lcd_data            <= 8'h00;
        end else begin
            case (state)
                ST_POWER_WAIT: begin
                    lcd_e <= 1'b0;
                    if (timer >= POWER_WAIT_CYCLES - 1) begin
                        timer <= 32'd0;
                        state <= ST_LOAD;
                    end else begin
                        timer <= timer + 1'b1;
                    end
                end

                ST_LOAD: begin
                    lcd_e <= 1'b0;
                    timer <= 32'd0;

                    if (mode == MODE_INIT) begin
                        lcd_rs <= 1'b0;
                        case (init_index)
                            3'd0: begin
                                lcd_data <= 8'h38; // 8-bit, 2-line, 5x8 font
                                command_wait_cycles <= COMMAND_CYCLES;
                            end
                            3'd1: begin
                                lcd_data <= 8'h08; // display off during setup
                                command_wait_cycles <= COMMAND_CYCLES;
                            end
                            3'd2: begin
                                lcd_data <= 8'h01; // clear display
                                command_wait_cycles <= CLEAR_CYCLES;
                            end
                            default: begin
                                lcd_data <= 8'h06; // increment cursor, no shift
                                command_wait_cycles <= COMMAND_CYCLES;
                            end
                        endcase
                    end else begin
                        command_wait_cycles <= COMMAND_CYCLES;
                        case (page_index)
                            6'd0: begin
                                lcd_rs <= 1'b0;
                                lcd_data <= 8'h08; // hide partial page update
                            end
                            6'd1: begin
                                lcd_rs <= 1'b0;
                                lcd_data <= 8'h80; // first-row DDRAM address
                            end
                            6'd18: begin
                                lcd_rs <= 1'b0;
                                lcd_data <= 8'hc0; // second-row DDRAM address
                            end
                            6'd35: begin
                                lcd_rs <= 1'b0;
                                lcd_data <= 8'h0c; // display on, cursor off
                            end
                            default: begin
                                lcd_rs <= 1'b1;
                                if (page_index >= 6'd2 && page_index <= 6'd17)
                                    lcd_data <= page_char(page_select, page_index[4:0] - 5'd2);
                                else
                                    lcd_data <= page_char(page_select, page_index[4:0] - 5'd3);
                            end
                        endcase
                    end

                    state <= ST_SETUP;
                end

                ST_SETUP: begin
                    if (timer >= SETUP_CYCLES - 1) begin
                        timer <= 32'd0;
                        lcd_e <= 1'b1;
                        state <= ST_ENABLE;
                    end else begin
                        timer <= timer + 1'b1;
                    end
                end

                ST_ENABLE: begin
                    if (timer >= ENABLE_CYCLES - 1) begin
                        timer <= 32'd0;
                        lcd_e <= 1'b0;
                        state <= ST_COMMAND_GAP;
                    end else begin
                        timer <= timer + 1'b1;
                    end
                end

                ST_COMMAND_GAP: begin
                    if (timer >= command_wait_cycles - 1) begin
                        timer <= 32'd0;
                        if (mode == MODE_INIT) begin
                            if (init_index == 3'd3) begin
                                mode <= MODE_PAGE;
                                page_index <= 6'd0;
                            end else begin
                                init_index <= init_index + 1'b1;
                            end
                            state <= ST_LOAD;
                        end else if (page_index == 6'd35) begin
                            state <= ST_PAGE_HOLD;
                        end else begin
                            page_index <= page_index + 1'b1;
                            state <= ST_LOAD;
                        end
                    end else begin
                        timer <= timer + 1'b1;
                    end
                end

                ST_PAGE_HOLD: begin
                    if (timer >= PAGE_HOLD_CYCLES - 1) begin
                        timer <= 32'd0;
                        page_select <= ~page_select;
                        page_index <= 6'd0;
                        state <= ST_LOAD;
                    end else begin
                        timer <= timer + 1'b1;
                    end
                end

                default: begin
                    state <= ST_POWER_WAIT;
                    timer <= 32'd0;
                    lcd_e <= 1'b0;
                    lcd_rs <= 1'b0;
                    lcd_data <= 8'h00;
                end
            endcase
        end
    end
endmodule
