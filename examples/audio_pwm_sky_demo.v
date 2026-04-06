module audio_pwm_sky_demo #(
    parameter integer CLK_HZ = 700_000
) (
    input  wire clk,
    input  wire rst,
    output reg  audio_pwm
);
    // A closer, recognizable Castle in the Sky-style lead line for Aspen Audio PWM.
    // Still simplified for tiny FPGA demos: single-voice square wave, no accompaniment.

    localparam integer REST = 0;
    localparam integer UNIT_TICKS = CLK_HZ / 10; // ~100 ms base step

    localparam integer E4 = CLK_HZ / (330 * 2);
    localparam integer FS4 = CLK_HZ / (370 * 2);
    localparam integer G4 = CLK_HZ / (392 * 2);
    localparam integer A4 = CLK_HZ / (440 * 2);
    localparam integer B4 = CLK_HZ / (494 * 2);
    localparam integer C5 = CLK_HZ / (523 * 2);
    localparam integer D5 = CLK_HZ / (587 * 2);
    localparam integer E5 = CLK_HZ / (659 * 2);
    localparam integer FS5 = CLK_HZ / (740 * 2);
    localparam integer G5 = CLK_HZ / (784 * 2);

    reg [31:0] step_tick;
    reg [7:0]  step_index;
    reg [31:0] tone_tick;

    wire [31:0] current_divider;
    wire [31:0] current_length_units;
    wire [31:0] current_step_ticks;

    assign current_divider = melody_divider(step_index);
    assign current_length_units = melody_length(step_index);
    assign current_step_ticks = (current_length_units == 0) ? UNIT_TICKS : (UNIT_TICKS * current_length_units);

    function [31:0] melody_divider;
        input [7:0] step;
        begin
            case (step)
                // Phrase A
                8'd0:  melody_divider = A4;
                8'd1:  melody_divider = B4;
                8'd2:  melody_divider = C5;
                8'd3:  melody_divider = E5;
                8'd4:  melody_divider = D5;
                8'd5:  melody_divider = C5;
                8'd6:  melody_divider = B4;
                8'd7:  melody_divider = G4;
                8'd8:  melody_divider = A4;
                8'd9:  melody_divider = B4;
                8'd10: melody_divider = C5;
                8'd11: melody_divider = D5;
                8'd12: melody_divider = E5;
                8'd13: melody_divider = D5;
                8'd14: melody_divider = C5;
                8'd15: melody_divider = B4;

                // Phrase B
                8'd16: melody_divider = A4;
                8'd17: melody_divider = G4;
                8'd18: melody_divider = A4;
                8'd19: melody_divider = B4;
                8'd20: melody_divider = C5;
                8'd21: melody_divider = B4;
                8'd22: melody_divider = A4;
                8'd23: melody_divider = G4;
                8'd24: melody_divider = E4;
                8'd25: melody_divider = G4;
                8'd26: melody_divider = A4;
                8'd27: melody_divider = B4;
                8'd28: melody_divider = A4;
                8'd29: melody_divider = G4;
                8'd30: melody_divider = E4;
                8'd31: melody_divider = REST;

                // Phrase A'
                8'd32: melody_divider = A4;
                8'd33: melody_divider = B4;
                8'd34: melody_divider = C5;
                8'd35: melody_divider = E5;
                8'd36: melody_divider = D5;
                8'd37: melody_divider = C5;
                8'd38: melody_divider = B4;
                8'd39: melody_divider = G4;
                8'd40: melody_divider = A4;
                8'd41: melody_divider = B4;
                8'd42: melody_divider = C5;
                8'd43: melody_divider = D5;
                8'd44: melody_divider = E5;
                8'd45: melody_divider = FS5;
                8'd46: melody_divider = G5;
                8'd47: melody_divider = E5;

                // Phrase C / cadence
                8'd48: melody_divider = D5;
                8'd49: melody_divider = C5;
                8'd50: melody_divider = B4;
                8'd51: melody_divider = A4;
                8'd52: melody_divider = B4;
                8'd53: melody_divider = C5;
                8'd54: melody_divider = D5;
                8'd55: melody_divider = B4;
                8'd56: melody_divider = A4;
                8'd57: melody_divider = G4;
                8'd58: melody_divider = E4;
                8'd59: melody_divider = FS4;
                8'd60: melody_divider = G4;
                8'd61: melody_divider = A4;
                8'd62: melody_divider = G4;
                8'd63: melody_divider = REST;
                default: melody_divider = REST;
            endcase
        end
    endfunction

    function [31:0] melody_length;
        input [7:0] step;
        begin
            case (step)
                8'd3,
                8'd7,
                8'd12,
                8'd15,
                8'd20,
                8'd23,
                8'd28,
                8'd31,
                8'd35,
                8'd39,
                8'd44,
                8'd47,
                8'd52,
                8'd55,
                8'd60,
                8'd63: melody_length = 2;
                default: melody_length = 1;
            endcase
        end
    endfunction

    always @(posedge clk) begin
        if (rst) begin
            step_tick <= 0;
            step_index <= 0;
            tone_tick <= 0;
            audio_pwm <= 1'b0;
        end else begin
            if (step_tick >= current_step_ticks - 1) begin
                step_tick <= 0;
                if (step_index >= 8'd63) begin
                    step_index <= 0;
                end else begin
                    step_index <= step_index + 1'b1;
                end
            end else begin
                step_tick <= step_tick + 1'b1;
            end

            if (current_divider == REST) begin
                tone_tick <= 0;
                audio_pwm <= 1'b0;
            end else if (tone_tick >= current_divider - 1) begin
                tone_tick <= 0;
                audio_pwm <= ~audio_pwm;
            end else begin
                tone_tick <= tone_tick + 1'b1;
            end
        end
    end
endmodule
