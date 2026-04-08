Use this device to observe VGA-style video timing and pixel buses and reconstruct the sampled stream into a screen image.

## Signals

- Continuously observes `HSYNC`, `VSYNC`, and the RGB buses
- `HSYNC` marks line boundaries
- `VSYNC` marks frame boundaries
- The RGB buses provide pixel color data

## How the image is reconstructed

- Sync signals are used to divide the stream into lines and frames, then RGB samples are read in order to rebuild the image.
- Even with non-standard pixel clocks, the image is reconstructed from the observed timing and pixel stream as they arrive.

## Parameters

- The resolution parameter defines the target pixel array used during reconstruction.
- The color-mode parameter defines how RGB bus bits map into color channels.
