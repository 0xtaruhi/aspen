Use this device to connect virtual ROM or RAM to the design. It supports file initialization and also shows addresses, output data, and RAM write results while running.

## Mode differences

- `ROM`: read-only, with address input and data output
- `RAM`: readable and writable, with additional `DIN` and `WE`

After switching modes, both the pin list and the internal behavior change.

## Control-signal conventions

- `CS`: active-low chip select
- `OE`: active-low read-output enable
- `WE`: active-low write enable, present only in RAM mode

If your design defines these controls as active-high, invert them in RTL before connecting them here.

## Supported initialization files

Supported input formats:

- Vivado: `.mem`, `.coe`
- Quartus: `.mif`
- Intel HEX: `.hex`
- Raw binary: `.bin`
- Plain text: parsed as hexadecimal by default, with support for `0x / 0b / 0o / 0d` prefixes and `@ADDR` jumps

This is useful for fonts, lookup tables, initialized programs, test vectors, and soft-core ROM contents.

## What you can observe

- Total word count
- Current accessed address
- Current output word
- Current memory contents inside the preview window

For RAM, runtime writes are reflected directly in the device state, so you can verify the write path while the design is running.

## Good for debugging

- Whether address-bit ordering is correct
- Whether ROM initialization data was loaded correctly
- Whether RAM write-enable timing is correct
- Whether `CS / OE / WE` control logic has inverted polarity or timing mistakes
