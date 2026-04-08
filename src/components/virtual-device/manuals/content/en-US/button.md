Use this device to generate a momentary push-button signal.

## Good for

- Single-step triggers
- Confirm / reset buttons
- Interrupt request testing

## Behavior

- The active-level parameter decides whether pressing the button drives a high or low level.
- This device models only explicit pressed / released states and does not apply debouncing.
- If your design needs debounce handling, keep that logic in RTL.
