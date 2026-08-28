module selectable_tone (
    input  wire       clk,
    input  wire       enable,
    input  wire [2:0] note_select,
    output reg        audio_pwm
);
    reg [15:0] counter = 0;
    reg [15:0] half_period;

    always @* begin
        case (note_select)
            3'd0: half_period = 16'd57334; // C4
            3'd1: half_period = 16'd51020; // D4
            3'd2: half_period = 16'd45455; // E4
            3'd3: half_period = 16'd42918; // F4
            3'd4: half_period = 16'd38265; // G4
            3'd5: half_period = 16'd34091; // A4
            3'd6: half_period = 16'd30364; // B4
            default: half_period = 16'd28667; // C5
        endcase
    end

    always @(posedge clk) begin
        if (!enable) begin
            counter <= 0;
            audio_pwm <= 1'b0;
        end else if (counter >= half_period - 1'b1) begin
            counter <= 0;
            audio_pwm <= ~audio_pwm;
        end else begin
            counter <= counter + 1'b1;
        end
    end
endmodule
