# Aspen 0.6.4

Aspen 0.6.4 upgrades its implementation backend to the published crates.io
`fde` 2.0.1 release.

- Full-width 256×16 dual-port BRAM designs that previously failed routing now
  route successfully. The FDE fix reserves compatible paths through saturated
  BRAM input/output channel groups.
- Static timing is reported as passing only when FDE explicitly reports
  `timing_met = true`. An unconstrained or unmodeled timing result remains
  unsuccessful.

The BRAM fix passed physical-board validation with the shared continuous P77
fabric clock: direct dual-port read/write tests checked 98,304 settled samples
with zero mismatches, and autonomous tests for two placement seeds both completed
with `done=1`, `pass=1`, and `fail=0`.

See [FDE 2.0.1](https://github.com/0xtaruhi/fde-rs/releases/tag/v2.0.1),
[the backend upgrade](https://github.com/0xtaruhi/aspen/pull/159), and
[the timing integration](https://github.com/0xtaruhi/aspen/pull/153).
