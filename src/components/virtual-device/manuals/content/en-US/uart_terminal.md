Use this device to interact with the design over UART. It can both send serial bytes into the design and decode text transmitted back from the design.

## Direction conventions

- `RX` is the line driven into the design.
- `TX` is the line sampled from the design.
- Visible pins change with the selected `TX only / RX only / TX + RX` mode.

## UART model

- Uses the common **8N1** frame format
- Idle level is high
- The bit duration is determined by `cycles per bit`
- Both transmit and receive depend on the real-time data stream, so this behaves like a stream-sampled UART rather than a fully independent precise serial simulator

## Why `cycles per bit` matters

- This value specifies how many sample periods one UART bit spans in the data stream.
- It should match the bit period used in the design.

## Good for

- Viewing boot logs, status prints, and command echoes
- Sending simple commands, ASCII text, or test input into the design
- Debugging UART transmitters, receivers, dividers, and framing logic
