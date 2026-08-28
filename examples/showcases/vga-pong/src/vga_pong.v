module vga_pong (
    input  wire       clk,
    input  wire       reset,
    input  wire       paddle_up,
    input  wire       paddle_down,
    output wire       vga_hsync,
    output wire       vga_vsync,
    output reg  [7:0] vga_rgb,
    output reg  [7:0] score_segments,
    output reg  [1:0] score_digit_select,
    output reg        audio_pwm
);
    localparam H_VISIBLE = 640;
    localparam H_TOTAL = 800;
    localparam V_VISIBLE = 480;
    localparam V_TOTAL = 525;

    reg [9:0] x = 0;
    reg [9:0] y = 0;
    reg [9:0] paddle_y = 200;
    reg [9:0] opponent_y = 200;
    reg [9:0] ball_x = 320;
    reg [9:0] ball_y = 240;
    reg ball_right = 1'b1;
    reg ball_down = 1'b1;
    reg [3:0] player_score = 0;
    reg [3:0] opponent_score = 0;
    reg [9:0] display_scan = 0;
    reg [21:0] beep_ticks = 0;
    reg [14:0] tone_count = 0;
    reg [3:0] score_nibble;

    wire visible = x < H_VISIBLE && y < V_VISIBLE;
    wire frame_tick = x == H_TOTAL - 1 && y == V_TOTAL - 1;
    wire player_pixel = x >= 24 && x < 32 && y >= paddle_y && y < paddle_y + 80;
    wire opponent_pixel = x >= 608 && x < 616 && y >= opponent_y && y < opponent_y + 80;
    wire ball_pixel = x >= ball_x && x < ball_x + 8 && y >= ball_y && y < ball_y + 8;
    wire border_pixel = y < 4 || y >= 476;
    wire center_pixel = x >= 318 && x < 322 && y[4];

    assign vga_hsync = ~((x >= 656) && (x < 752));
    assign vga_vsync = ~((y >= 490) && (y < 492));

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
        if (!visible)
            vga_rgb = 8'h00;
        else if (ball_pixel)
            vga_rgb = 8'b111_111_00;
        else if (player_pixel)
            vga_rgb = 8'b000_111_11;
        else if (opponent_pixel)
            vga_rgb = 8'b111_000_11;
        else if (border_pixel || center_pixel)
            vga_rgb = 8'b110_110_10;
        else
            vga_rgb = 8'b000_001_00;

        score_digit_select = display_scan[9] ? 2'b10 : 2'b01;
        score_nibble = display_scan[9] ? opponent_score : player_score;
        score_segments = hex_segments(score_nibble);
    end

    always @(posedge clk) begin
        if (reset) begin
            x <= 0;
            y <= 0;
            paddle_y <= 200;
            opponent_y <= 200;
            ball_x <= 320;
            ball_y <= 240;
            ball_right <= 1'b1;
            ball_down <= 1'b1;
            player_score <= 0;
            opponent_score <= 0;
            display_scan <= 0;
            beep_ticks <= 0;
            tone_count <= 0;
            audio_pwm <= 1'b0;
        end else begin
            display_scan <= display_scan + 1'b1;
            if (x == H_TOTAL - 1) begin
                x <= 0;
                y <= (y == V_TOTAL - 1) ? 0 : y + 1'b1;
            end else begin
                x <= x + 1'b1;
            end

            if (beep_ticks == 0) begin
                tone_count <= 0;
                audio_pwm <= 1'b0;
            end else begin
                beep_ticks <= beep_ticks - 1'b1;
                if (tone_count == 15'd14999) begin
                    tone_count <= 0;
                    audio_pwm <= ~audio_pwm;
                end else begin
                    tone_count <= tone_count + 1'b1;
                end
            end

            if (frame_tick) begin
                if (paddle_up && paddle_y >= 4)
                    paddle_y <= paddle_y - 4;
                else if (paddle_down && paddle_y <= 396)
                    paddle_y <= paddle_y + 4;

                if (ball_y < 40)
                    opponent_y <= 0;
                else if (ball_y > 439)
                    opponent_y <= 400;
                else
                    opponent_y <= ball_y - 40;

                if (ball_down) begin
                    if (ball_y >= 470) begin
                        ball_down <= 1'b0;
                        beep_ticks <= 22'd450000;
                    end else begin
                        ball_y <= ball_y + 2;
                    end
                end else if (ball_y <= 2) begin
                    ball_down <= 1'b1;
                    beep_ticks <= 22'd450000;
                end else begin
                    ball_y <= ball_y - 2;
                end

                if (!ball_right && ball_x <= 32 && ball_y + 8 >= paddle_y && ball_y < paddle_y + 80) begin
                    ball_right <= 1'b1;
                    beep_ticks <= 22'd900000;
                end else if (!ball_right && ball_x <= 2) begin
                    opponent_score <= opponent_score + 1'b1;
                    ball_x <= 320;
                    ball_y <= 240;
                    ball_right <= 1'b1;
                    beep_ticks <= 22'd1800000;
                end else if (ball_right && ball_x >= 600 && ball_y + 8 >= opponent_y && ball_y < opponent_y + 80) begin
                    ball_right <= 1'b0;
                    beep_ticks <= 22'd900000;
                end else if (ball_right && ball_x >= 630) begin
                    player_score <= player_score + 1'b1;
                    ball_x <= 320;
                    ball_y <= 240;
                    ball_right <= 1'b0;
                    beep_ticks <= 22'd1800000;
                end else if (ball_right) begin
                    ball_x <= ball_x + 2;
                end else begin
                    ball_x <= ball_x - 2;
                end
            end
        end
    end
endmodule
