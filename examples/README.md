# Aspen example projects

Each directory below is a complete Aspen project. In Aspen, choose **New Project → Example
Projects** to create an editable copy, or open its `aspen.project.json` directly from this repository.
Run synthesis and implementation, program the board, then open the Virtual Device workspace. Pin
assignments, device placement, and signal bindings are already included.

Most designs assume the FDP3P7 reference board's 30 MHz clock. The HD44780 lab instead uses a
1.6 MHz timing ceiling so it remains safe across Aspen's current VLFD runtime range.

## Device labs

| Project                                                            | Virtual devices                               | What it demonstrates                                |
| ------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------- |
| [`device-labs/gpio-controls`](device-labs/gpio-controls)           | Switch, button, DIP switch bank, LED, LED bar | DIP input with invert and clear controls            |
| [`device-labs/led-matrix`](device-labs/led-matrix)                 | Button, 8x8 LED matrix                        | Row scanning and animation                          |
| [`device-labs/uart-terminal`](device-labs/uart-terminal)           | Button, UART terminal                         | Full-duplex serial echo                             |
| [`device-labs/hd44780-lcd`](device-labs/hd44780-lcd)               | Button, HD44780 LCD                           | 8-bit LCD initialization and alternating demo pages |
| [`device-labs/quadrature-encoder`](device-labs/quadrature-encoder) | Rotary encoder, seven-segment display         | Quadrature decoding and position display            |
| [`device-labs/audio-pwm`](device-labs/audio-pwm)                   | Switch, DIP switch bank, Audio PWM            | Selectable square-wave tone generation              |

## Showcase projects

| Project                                    | Virtual devices                                        | What it demonstrates              |
| ------------------------------------------ | ------------------------------------------------------ | --------------------------------- |
| [`showcases/vga-pong`](showcases/vga-pong) | VGA display, buttons, seven-segment display, Audio PWM | A complete interactive video game |

New user-facing examples should be added as complete project directories. The focused labs and VGA
Pong together cover every virtual-device type supported by Aspen.

## Showcase controls

- **VGA Pong:** hold the up/down buttons to move the cyan paddle. The magenta paddle is automatic;
  the score display and audio device report game events. Press New Game to reset.
