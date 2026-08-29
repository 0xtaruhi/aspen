module gpio_controls (
    input  wire       invert_switch,
    input  wire       clear_button,
    input  wire [7:0] dip,
    output wire       inverted_led,
    output wire [7:0] led_bar
);
    assign inverted_led = invert_switch;
    assign led_bar = clear_button ? 8'h00 : (invert_switch ? ~dip : dip);
endmodule
