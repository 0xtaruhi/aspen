Use this device to observe scanned LED matrix outputs and reconstruct the continuously scanned row and column signals into a stable pixel image.

## How it works

- Row lines come from the design and indicate which row is currently selected.
- Column lines come from the design and indicate which pixels in that row are lit.
- Samples accumulated across repeated scan cycles are merged into a stable matrix image.

## Good for

- Debugging scrolling text, frame-by-frame animation, and simple icons
- Checking whether rows and columns are swapped
- Confirming that the scan timing is stable

## What the resolution parameter means

- The row and column counts define the matrix grid size.
- When the size changes, existing bindings keep overlapping slots whenever possible.
