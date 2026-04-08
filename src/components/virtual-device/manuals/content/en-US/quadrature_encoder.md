Use this device to inject quadrature encoder signals into the design. It is suitable for simulating rotary knobs and encoders with an optional push switch.

## Outputs

- `A` / `B`: standard quadrature phases
- `SW`: optional push switch

If the push-switch parameter is disabled, the `SW` slot is removed from the device definition.

## Rotation model

- Clockwise and counter-clockwise rotation generate opposite A/B phase orders.
- This is useful for testing incremental counting, direction detection, and menu-navigation input.
- The current model focuses on logical phase relationships and does not simulate mechanical bounce.

## Good for debugging

- Encoder phase decoding
- Up/down counting
- Direction inversion checks
- User-interface control logic for pressable rotary knobs
