module gpio_controls (
    input  wire       clk,
    input  wire       mode_switch,
    input  wire       invert_button,
    input  wire [7:0] dip,
    output wire       status_led,
    output wire [7:0] led_bar
);
    reg invert_latched = 1'b0;
    reg button_previous = 1'b0;

    always @(posedge clk) begin
        button_previous <= invert_button;
        if (invert_button && !button_previous)
            invert_latched <= ~invert_latched;
    end

    assign status_led = mode_switch ^ invert_latched;
    assign led_bar = dip ^ {8{invert_latched}};
endmodule
