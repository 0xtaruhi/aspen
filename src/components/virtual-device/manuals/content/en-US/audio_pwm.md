Use this device to observe single-wire PWM audio output and estimate its current dominant frequency and duty cycle.

## What you can observe

- Whether the output is currently active
- Estimated frequency
- High-level duty ratio
- Edge count

These values come from real-time stream samples, not from direct reads of internal FPGA registers.

## How the frequency is estimated

- The period is estimated from the sample distance between rising edges.
- That period is then scaled by the current data-stream sample rate into an approximate frequency.
- It behaves more like a logic-level frequency probe than a precision audio spectrum analyzer.

## Good for debugging

- Whether the buzzer is really oscillating
- Whether the melody generator switched to the expected pitch
- Whether the duty cycle stays in the expected range
- Whether the PWM output is stuck at a constant level
