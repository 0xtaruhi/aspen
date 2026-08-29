# Aspen example projects

Each directory below is a complete Aspen project. In Aspen, choose **New Project → Example
Projects** to create an editable copy, or open its `aspen.project.json` directly from this repository.
Run synthesis and implementation, program the board, then open the Virtual Device workspace. Pin
assignments, device placement, and signal bindings are already included.

The designs assume the FDP3P7 reference board's 30 MHz clock.

## Device labs

| Project                                                            | Virtual devices                               | What it demonstrates                         |
| ------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------- |
| [`device-labs/gpio-controls`](device-labs/gpio-controls)           | Switch, button, DIP switch bank, LED, LED bar | DIP input with invert and clear controls     |
| [`device-labs/segment-counter`](device-labs/segment-counter)       | Button, 4-digit seven-segment display         | Multiplexing and hexadecimal display         |
| [`device-labs/led-matrix`](device-labs/led-matrix)                 | Button, 8x8 LED matrix                        | Row scanning and animation                   |
| [`device-labs/uart-terminal`](device-labs/uart-terminal)           | Button, UART terminal                         | Full-duplex serial echo                      |
| [`device-labs/hd44780-lcd`](device-labs/hd44780-lcd)               | Button, HD44780 LCD                           | 4-bit LCD initialization and text output     |
| [`device-labs/quadrature-encoder`](device-labs/quadrature-encoder) | Rotary encoder, seven-segment display         | Quadrature decoding and position display     |
| [`device-labs/audio-pwm`](device-labs/audio-pwm)                   | Switch, DIP switch bank, Audio PWM            | Selectable square-wave tone generation       |
| [`device-labs/vga-display`](device-labs/vga-display)               | VGA display                                   | 320x240 RGB332 video timing and test pattern |

Together, these labs cover every virtual-device type supported by Aspen.

## Showcase projects

| Project                                    | Virtual devices                                        | What it demonstrates              |
| ------------------------------------------ | ------------------------------------------------------ | --------------------------------- |
| [`showcases/vga-pong`](showcases/vga-pong) | VGA display, buttons, seven-segment display, Audio PWM | A complete interactive video game |

The original loose HDL smoke tests remain at the root of `examples/` for scripts and quick synthesis
checks. New user-facing examples should be added as complete project directories.

## Showcase controls

- **VGA Pong:** hold the up/down buttons to move the cyan paddle. The magenta paddle is automatic;
  the score display and audio device report game events. Press New Game to reset.
