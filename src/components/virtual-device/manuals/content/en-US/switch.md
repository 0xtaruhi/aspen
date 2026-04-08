Use this device to continuously drive one logic input into the design.

## Good for

- Mode selection
- Enable control
- Static configuration inputs
- Simple interactive testing

## Behavior

- After the toggle changes position, the new logic level is held continuously at the output.
- This is closer to a physical slide switch on a board than to a momentary button.
- If the input is asynchronous in RTL, it is still a good idea to synchronize it inside the design.
