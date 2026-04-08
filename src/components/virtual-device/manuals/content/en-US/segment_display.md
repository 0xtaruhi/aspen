Use this device to observe segment-select and digit-select signals on seven-segment displays and reconstruct the scanned outputs into a stable multi-digit display.

## Two operating modes

- Single digit: only the segment bus is required
- Multi-digit: the display combines segment and digit scan timing to rebuild each digit

When the digit count changes, the binding slots change with it.

## Lit polarity

- The lit-level parameter specifies whether a lit segment is active-high or active-low.
- This usually matches whether the physical driver uses common-cathode or common-anode wiring.

## How the display is reconstructed

- For multi-digit displays, the active times of each selected digit are tracked in the real-time stream.
- The segment state seen while one digit is selected is accumulated into that digit's final mask.
- This makes it suitable for observing the final visual result of a scanned display rather than a single instantaneous sample.

## Good for debugging

- Whether the segment order is correct, such as `A/B/C/D/E/F/G/DP`
- Whether digit order is reversed
- Whether multi-digit scan timing is uniform
- Whether common-anode / common-cathode polarity is configured correctly
