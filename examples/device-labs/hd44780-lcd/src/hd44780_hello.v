module hd44780_hello (
    input  wire       clk,
    input  wire       reset,
    output reg        lcd_rs,
    output wire       lcd_rw,
    output reg        lcd_e,
    output reg  [3:0] lcd_data
);
    reg [5:0] byte_index = 0;
    reg [3:0] phase_count = 0;
    reg [1:0] phase = 0;
    wire [7:0] current_byte;
    wire current_rs;

    assign lcd_rw = 1'b0;
    assign current_rs = (byte_index >= 2 && byte_index <= 17) || byte_index >= 19;

    function [7:0] text_byte;
        input [5:0] index;
        begin
            case (index)
                0: text_byte = 8'h01;
                1: text_byte = 8'h80;
                2: text_byte = "A";  3: text_byte = "S";
                4: text_byte = "P";  5: text_byte = "E";
                6: text_byte = "N";  7: text_byte = " ";
                8: text_byte = "D";  9: text_byte = "E";
                10: text_byte = "V"; 11: text_byte = "I";
                12: text_byte = "C"; 13: text_byte = "E";
                14: text_byte = " "; 15: text_byte = "L";
                16: text_byte = "A"; 17: text_byte = "B";
                18: text_byte = 8'hC0;
                19: text_byte = "V"; 20: text_byte = "I";
                21: text_byte = "R"; 22: text_byte = "T";
                23: text_byte = "U"; 24: text_byte = "A";
                25: text_byte = "L"; 26: text_byte = " ";
                27: text_byte = "L"; 28: text_byte = "C";
                29: text_byte = "D"; 30: text_byte = " ";
                31: text_byte = "O"; 32: text_byte = "K";
                default: text_byte = " ";
            endcase
        end
    endfunction

    assign current_byte = text_byte(byte_index);

    always @(posedge clk) begin
        if (reset) begin
            byte_index <= 0;
            phase_count <= 0;
            phase <= 0;
            lcd_rs <= 0;
            lcd_e <= 0;
            lcd_data <= 0;
        end else if (byte_index < 35) begin
            if (phase_count == 15) begin
                phase_count <= 0;
                case (phase)
                    0: begin
                        lcd_rs <= current_rs;
                        lcd_data <= current_byte[7:4];
                        lcd_e <= 1'b1;
                        phase <= 1;
                    end
                    1: begin
                        lcd_e <= 1'b0;
                        phase <= 2;
                    end
                    2: begin
                        lcd_data <= current_byte[3:0];
                        lcd_e <= 1'b1;
                        phase <= 3;
                    end
                    default: begin
                        lcd_e <= 1'b0;
                        phase <= 0;
                        byte_index <= byte_index + 1'b1;
                    end
                endcase
            end else begin
                phase_count <= phase_count + 1'b1;
            end
        end
    end
endmodule
