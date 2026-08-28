module keypad_calculator (
    input  wire       clk,
    input  wire       reset,
    input  wire [3:0] keypad_columns,
    output reg  [3:0] keypad_rows,
    output reg  [7:0] segments,
    output reg  [3:0] digit_select,
    output reg        result_ready
);
    reg [9:0] scan_divider = 0;
    reg [1:0] scan_row = 0;
    reg [4:0] held_key = 5'h1f;
    reg [9:0] release_count = 0;
    reg [15:0] entry = 0;
    reg [15:0] accumulator = 0;
    reg [1:0] pending_operation = 0;
    reg [1:0] display_digit;
    reg [3:0] display_nibble;
    reg [4:0] sampled_key;
    reg sampled_valid;

    function [3:0] key_digit;
        input [4:0] key;
        begin
            case (key)
                0: key_digit = 1; 1: key_digit = 2; 2: key_digit = 3;
                4: key_digit = 4; 5: key_digit = 5; 6: key_digit = 6;
                8: key_digit = 7; 9: key_digit = 8; 10: key_digit = 9;
                default: key_digit = 0;
            endcase
        end
    endfunction

    function is_digit_key;
        input [4:0] key;
        begin
            is_digit_key = (key <= 2) || (key >= 4 && key <= 6) ||
                           (key >= 8 && key <= 10) || key == 13;
        end
    endfunction

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

    always @* begin
        keypad_rows = 4'b1111;
        keypad_rows[scan_row] = 1'b0;
        sampled_valid = keypad_columns != 4'b1111;
        if (!keypad_columns[0])
            sampled_key = {1'b0, scan_row, 2'd0};
        else if (!keypad_columns[1])
            sampled_key = {1'b0, scan_row, 2'd1};
        else if (!keypad_columns[2])
            sampled_key = {1'b0, scan_row, 2'd2};
        else
            sampled_key = {1'b0, scan_row, 2'd3};

        display_digit = scan_divider[9:8];
        digit_select = 4'b0001 << display_digit;
        case (display_digit)
            0: display_nibble = entry[3:0];
            1: display_nibble = entry[7:4];
            2: display_nibble = entry[11:8];
            default: display_nibble = entry[15:12];
        endcase
        segments = hex_segments(display_nibble);
    end

    always @(posedge clk) begin
        if (reset) begin
            scan_divider <= 0;
            scan_row <= 0;
            held_key <= 5'h1f;
            release_count <= 0;
            entry <= 0;
            accumulator <= 0;
            pending_operation <= 0;
            result_ready <= 0;
        end else begin
            scan_divider <= scan_divider + 1'b1;
            scan_row <= scan_divider[7:6];

            if (sampled_valid) begin
                release_count <= 0;
                if (sampled_key != held_key) begin
                    held_key <= sampled_key;
                    result_ready <= 0;
                    if (is_digit_key(sampled_key)) begin
                        entry <= {entry[11:0], key_digit(sampled_key)};
                    end else begin
                        case (sampled_key)
                            3: begin // A: add
                                accumulator <= entry;
                                entry <= 0;
                                pending_operation <= 1;
                            end
                            7: begin // B: subtract
                                accumulator <= entry;
                                entry <= 0;
                                pending_operation <= 2;
                            end
                            11: begin // C: clear
                                entry <= 0;
                                accumulator <= 0;
                                pending_operation <= 0;
                            end
                            12: entry <= {4'h0, entry[15:4]}; // *: backspace
                            14, 15: begin // # or D: equals
                                if (pending_operation == 1)
                                    entry <= accumulator + entry;
                                else if (pending_operation == 2)
                                    entry <= accumulator - entry;
                                pending_operation <= 0;
                                result_ready <= 1;
                            end
                            default: entry <= entry;
                        endcase
                    end
                end
            end else if (release_count == 10'h3ff) begin
                held_key <= 5'h1f;
            end else begin
                release_count <= release_count + 1'b1;
            end
        end
    end
endmodule
