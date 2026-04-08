Use this device to drive a group of input bits in parallel, similar to a DIP switch bank on a real board.

## Good for

- Driving configuration words, mode bits, address selects, and test vectors
- Simulating user changes to multiple input bits while the design is running

## Usage characteristics

- Each bit updates independently; the full bus does not need to switch in one cycle.
- When the width changes, existing bindings keep overlapping bits whenever possible.
- This is an input-only device. It writes state into the design and never reads feedback back out.
