Use this device to emulate a scanned matrix keypad rather than a simple bank of parallel buttons.

## The signal directions must match

- `ROW`: driven by the design, observed only
- `COL`: driven back into the design when a key press hits the active row

## Key-closure model

- The design usually scans the matrix row by row.
- When one row is currently selected and the matching key is pressed, the corresponding column is driven to the active level.
- The active-level parameter decides whether the column line is pulled high or low.

## Good for debugging

- Matrix scan controllers
- Behavior before and after keypad debounce
- Row / column wiring order
- Keycode decode logic
