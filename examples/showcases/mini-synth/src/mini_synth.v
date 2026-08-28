module mini_synth (
    input  wire       clk,
    input  wire [3:0] keypad_columns,
    input  wire       encoder_a,
    input  wire       encoder_b,
    input  wire       encoder_button,
    output reg  [3:0] keypad_rows,
    output reg        audio_pwm,
    output reg  [7:0] segments,
    output reg  [1:0] digit_select
);
    reg [9:0] scan_divider = 0;
    reg [1:0] scan_row = 0;
    reg [9:0] release_count = 0;
    reg [3:0] note = 0;
    reg note_active = 0;
    reg [1:0] octave = 1;
    reg [1:0] previous_ab = 0;
    reg [17:0] tone_count = 0;
    reg [4:0] sampled_key;
    reg sampled_valid;
    reg [3:0] display_nibble;
    wire [1:0] current_ab = {encoder_a, encoder_b};
    wire [17:0] half_period = note_half_period(note) >> octave;

    function [17:0] note_half_period;
        input [3:0] index;
        begin
            case (index)
                4'h0: note_half_period = 18'd114679; // C3
                4'h1: note_half_period = 18'd102041;
                4'h2: note_half_period = 18'd90909;
                4'h3: note_half_period = 18'd85837;
                4'h4: note_half_period = 18'd76531;
                4'h5: note_half_period = 18'd68182;
                4'h6: note_half_period = 18'd60729;
                4'h7: note_half_period = 18'd57334;
                4'h8: note_half_period = 18'd51020;
                4'h9: note_half_period = 18'd45455;
                4'hA: note_half_period = 18'd42918;
                4'hB: note_half_period = 18'd38265;
                4'hC: note_half_period = 18'd34091;
                4'hD: note_half_period = 18'd30364;
                4'hE: note_half_period = 18'd28667;
                default: note_half_period = 18'd25510;
            endcase
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

        digit_select = scan_divider[9] ? 2'b10 : 2'b01;
        display_nibble = scan_divider[9] ? {2'b00, octave} : note;
        segments = hex_segments(display_nibble);
    end

    always @(posedge clk) begin
        scan_divider <= scan_divider + 1'b1;
        scan_row <= scan_divider[7:6];
        previous_ab <= current_ab;

        if (encoder_button) begin
            octave <= 1;
        end else begin
            case ({previous_ab, current_ab})
                4'b0001, 4'b0111, 4'b1110, 4'b1000:
                    if (octave != 3) octave <= octave + 1'b1;
                4'b0010, 4'b1011, 4'b1101, 4'b0100:
                    if (octave != 0) octave <= octave - 1'b1;
                default: octave <= octave;
            endcase
        end

        if (sampled_valid) begin
            note <= sampled_key[3:0];
            note_active <= 1'b1;
            release_count <= 0;
        end else if (release_count == 10'h3ff) begin
            note_active <= 1'b0;
        end else begin
            release_count <= release_count + 1'b1;
        end

        if (!note_active) begin
            tone_count <= 0;
            audio_pwm <= 1'b0;
        end else if (tone_count >= half_period - 1'b1) begin
            tone_count <= 0;
            audio_pwm <= ~audio_pwm;
        end else begin
            tone_count <= tone_count + 1'b1;
        end
    end
endmodule
