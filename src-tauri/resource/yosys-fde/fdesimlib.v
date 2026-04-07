module LUT2 (O, ADR0, ADR1);

  parameter INIT = 4'h0;
  parameter LUT_INIT = INIT;

  output O;
  input ADR0, ADR1;
  assign O = LUT_INIT >> {ADR1, ADR0};

endmodule

module LUT3 (O, ADR0, ADR1, ADR2);

  parameter INIT = 8'h00;
  parameter LUT_INIT = INIT;

  output O;
  input ADR0, ADR1, ADR2;
  assign O = LUT_INIT >> {ADR2, ADR1, ADR0};

endmodule

module LUT4 (O, ADR0, ADR1, ADR2, ADR3);

  parameter INIT = 16'h0000;
  parameter LUT_INIT = INIT;

  output O;
  input ADR0, ADR1, ADR2, ADR3;

  assign O = LUT_INIT >> {ADR3, ADR2, ADR1, ADR0};

endmodule

module LUT5 (O, ADR0, ADR1, ADR2, ADR3, ADR4);

  parameter INIT = 32'h00000000;
  parameter LUT_INIT = INIT;

  input ADR0, ADR1, ADR2, ADR3, ADR4;

  output O;

  assign O = LUT_INIT >> {ADR4, ADR3, ADR2, ADR1, ADR0};

endmodule

module DFFHQ (Q, CK, D);
    output Q;
    input CK, D;
    reg Q;
    initial Q = 1'b0;
    always @(posedge CK)
    begin
        Q <= D;
    end
endmodule

module DFFRHQ (Q, CK, RN, D);
    output Q;
    input CK, RN, D;
    reg Q;
    initial Q = 1'b0;
    always @(posedge CK or negedge RN)
    begin
        if (RN == 0)
            Q <= 0;
        else
            Q <= D;
    end
endmodule

module DFFSHQ (Q, CK, SN, D);
    output Q;
    input CK, SN, D;
    reg Q;
    initial Q = 1'b0;
    always @(posedge CK or negedge SN)
    begin
        if (SN == 0)
            Q <= 1;
        else
            Q <= D;
    end
endmodule

module DFFNRHQ (Q, CKN, RN, D);
    output Q;
    input CKN, RN, D;
    reg Q;
    initial Q = 1'b0;
    always @(negedge CKN or negedge RN)
    begin
        if (RN == 0)
            Q <= 0;
        else
            Q <= D;
    end
endmodule

module DFFNSHQ (Q, CKN, SN, D);
    output Q;
    input CKN, SN, D;
    reg Q;
    initial Q = 1'b0;
    always @(negedge CKN or negedge SN)
    begin
        if (SN == 0)
            Q <= 1;
        else
            Q <= D;
    end
endmodule

module DFFNHQ (Q, CKN, D);
    output Q;
    input CKN, D;
    reg Q;
    initial Q = 1'b0;
    always @(negedge CKN)
    begin
        Q <= D;
    end
endmodule

module EDFFHQ (Q, CK, D, E);
    output Q;
    input CK, D, E;
    reg Q;
    initial Q = 1'b0;
    always @(posedge CK)
    begin
        if (E)
            Q <= D;
    end
endmodule

module EDFFTRHQ (Q, CK, D, E, RN);
    output Q;
    input CK, D, E, RN;
    reg Q;
    initial Q = 1'b0;
    always @(posedge CK)
    begin
        if (!RN)
            Q <= 0;
        else if (E)
            Q <= D;
    end
endmodule

module EDFFTSHQ (Q, CK, D, E, SN);
    output Q;
    input CK, D, E, SN;
    reg Q;
    initial Q = 1'b0;
    always @(posedge CK)
    begin
        if (!SN)
            Q <= 1;
        else if (E)
            Q <= D;
    end
endmodule

// Aspen FDE block RAM primitives

`define ASPEN_FDE_RAMB4_SP(NAME, DATA_WIDTH, ADDR_WIDTH) \
(* blackbox *) module NAME (DO, ADDR, DI, EN, CLK, WE, RST); \
  parameter [255:0] INIT_00 = 256'h0; \
  parameter [255:0] INIT_01 = 256'h0; \
  parameter [255:0] INIT_02 = 256'h0; \
  parameter [255:0] INIT_03 = 256'h0; \
  parameter [255:0] INIT_04 = 256'h0; \
  parameter [255:0] INIT_05 = 256'h0; \
  parameter [255:0] INIT_06 = 256'h0; \
  parameter [255:0] INIT_07 = 256'h0; \
  parameter [255:0] INIT_08 = 256'h0; \
  parameter [255:0] INIT_09 = 256'h0; \
  parameter [255:0] INIT_0A = 256'h0; \
  parameter [255:0] INIT_0B = 256'h0; \
  parameter [255:0] INIT_0C = 256'h0; \
  parameter [255:0] INIT_0D = 256'h0; \
  parameter [255:0] INIT_0E = 256'h0; \
  parameter [255:0] INIT_0F = 256'h0; \
  output [DATA_WIDTH-1:0] DO; \
  input [ADDR_WIDTH-1:0] ADDR; \
  input [DATA_WIDTH-1:0] DI; \
  input EN, CLK, WE, RST; \
endmodule

`define ASPEN_FDE_RAMB4_DP(NAME, DATA_WIDTH_A, ADDR_WIDTH_A, DATA_WIDTH_B, ADDR_WIDTH_B) \
(* blackbox *) module NAME (DOA, ADDRA, DIA, ENA, CLKA, WEA, RSTA, DOB, ADDRB, DIB, ENB, CLKB, WEB, RSTB); \
  parameter [255:0] INIT_00 = 256'h0; \
  parameter [255:0] INIT_01 = 256'h0; \
  parameter [255:0] INIT_02 = 256'h0; \
  parameter [255:0] INIT_03 = 256'h0; \
  parameter [255:0] INIT_04 = 256'h0; \
  parameter [255:0] INIT_05 = 256'h0; \
  parameter [255:0] INIT_06 = 256'h0; \
  parameter [255:0] INIT_07 = 256'h0; \
  parameter [255:0] INIT_08 = 256'h0; \
  parameter [255:0] INIT_09 = 256'h0; \
  parameter [255:0] INIT_0A = 256'h0; \
  parameter [255:0] INIT_0B = 256'h0; \
  parameter [255:0] INIT_0C = 256'h0; \
  parameter [255:0] INIT_0D = 256'h0; \
  parameter [255:0] INIT_0E = 256'h0; \
  parameter [255:0] INIT_0F = 256'h0; \
  output [DATA_WIDTH_A-1:0] DOA; \
  input [ADDR_WIDTH_A-1:0] ADDRA; \
  input [DATA_WIDTH_A-1:0] DIA; \
  input ENA, CLKA, WEA, RSTA; \
  output [DATA_WIDTH_B-1:0] DOB; \
  input [ADDR_WIDTH_B-1:0] ADDRB; \
  input [DATA_WIDTH_B-1:0] DIB; \
  input ENB, CLKB, WEB, RSTB; \
endmodule

`ASPEN_FDE_RAMB4_SP(RAMB4_S1, 1, 12)
`ASPEN_FDE_RAMB4_SP(RAMB4_S2, 2, 11)
`ASPEN_FDE_RAMB4_SP(RAMB4_S4, 4, 10)
`ASPEN_FDE_RAMB4_SP(RAMB4_S8, 8, 9)
`ASPEN_FDE_RAMB4_SP(RAMB4_S16, 16, 8)

`ASPEN_FDE_RAMB4_DP(RAMB4_S1_S1, 1, 12, 1, 12)
`ASPEN_FDE_RAMB4_DP(RAMB4_S1_S2, 1, 12, 2, 11)
`ASPEN_FDE_RAMB4_DP(RAMB4_S1_S4, 1, 12, 4, 10)
`ASPEN_FDE_RAMB4_DP(RAMB4_S1_S8, 1, 12, 8, 9)
`ASPEN_FDE_RAMB4_DP(RAMB4_S1_S16, 1, 12, 16, 8)
`ASPEN_FDE_RAMB4_DP(RAMB4_S2_S2, 2, 11, 2, 11)
`ASPEN_FDE_RAMB4_DP(RAMB4_S2_S4, 2, 11, 4, 10)
`ASPEN_FDE_RAMB4_DP(RAMB4_S2_S8, 2, 11, 8, 9)
`ASPEN_FDE_RAMB4_DP(RAMB4_S2_S16, 2, 11, 16, 8)
`ASPEN_FDE_RAMB4_DP(RAMB4_S4_S4, 4, 10, 4, 10)
`ASPEN_FDE_RAMB4_DP(RAMB4_S4_S8, 4, 10, 8, 9)
`ASPEN_FDE_RAMB4_DP(RAMB4_S4_S16, 4, 10, 16, 8)
`ASPEN_FDE_RAMB4_DP(RAMB4_S8_S8, 8, 9, 8, 9)
`ASPEN_FDE_RAMB4_DP(RAMB4_S8_S16, 8, 9, 16, 8)
`ASPEN_FDE_RAMB4_DP(RAMB4_S16_S16, 16, 8, 16, 8)

`undef ASPEN_FDE_RAMB4_SP
`undef ASPEN_FDE_RAMB4_DP
