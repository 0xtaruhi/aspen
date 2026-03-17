use std::{
    collections::{HashMap, VecDeque},
    time::Duration,
};

use crate::hardware::types::{
    CanvasDeviceBindingSnapshot, CanvasDeviceConfigSnapshot, CanvasDeviceSnapshot,
    CanvasDeviceStateSnapshot, CanvasDeviceType, HardwareSignalAggregateByIdV1,
};

use super::*;

fn sample(values: &[(u16, bool)]) -> HardwareDataSample {
    HardwareDataSample {
        values: values.to_vec(),
    }
}

fn single_binding(signal: Option<&str>) -> CanvasDeviceBindingSnapshot {
    CanvasDeviceBindingSnapshot::Single {
        signal: signal.map(str::to_string),
    }
}

fn slot_bindings(signals: &[Option<&str>]) -> CanvasDeviceBindingSnapshot {
    CanvasDeviceBindingSnapshot::Slots {
        signals: signals
            .iter()
            .map(|signal| signal.map(str::to_string))
            .collect(),
    }
}

fn no_config() -> CanvasDeviceConfigSnapshot {
    CanvasDeviceConfigSnapshot::None
}

fn button_config(active_low: bool) -> CanvasDeviceConfigSnapshot {
    CanvasDeviceConfigSnapshot::Button { active_low }
}

#[test]
fn aggregate_data_samples_tracks_latest_ratio_and_edges() {
    let mut queue = VecDeque::from([
        sample(&[(1, false), (2, true)]),
        sample(&[(1, true), (2, true)]),
        sample(&[(1, true), (2, false)]),
    ]);

    let updates = HardwareRuntime::aggregate_data_samples(&mut queue);
    assert_eq!(updates.len(), 2);

    let sig_a = updates.iter().find(|item| item.signal_id == 1).unwrap();
    assert!(sig_a.latest);
    assert_eq!(sig_a.edge_count, 1);
    assert!((sig_a.high_ratio - (2.0 / 3.0)).abs() < 0.0001);

    let sig_b = updates.iter().find(|item| item.signal_id == 2).unwrap();
    assert!(!sig_b.latest);
    assert_eq!(sig_b.edge_count, 1);
    assert!((sig_b.high_ratio - (2.0 / 3.0)).abs() < 0.0001);

    assert!(queue.is_empty());
}

#[test]
fn aggregate_data_samples_caps_payload_size() {
    let mut values = Vec::new();
    for index in 0..(DATA_MAX_UPDATES_PER_BATCH + 10) {
        values.push((index as u16, (index % 2) == 0));
    }

    let mut queue = VecDeque::from([HardwareDataSample { values }]);
    let updates = HardwareRuntime::aggregate_data_samples(&mut queue);
    assert_eq!(updates.len(), DATA_MAX_UPDATES_PER_BATCH);
}

#[test]
fn collect_data_sample_prefers_drivers_and_keeps_receiver_fallback() {
    let runtime = HardwareRuntime::default();

    {
        let mut state = runtime.state.lock().unwrap();
        let switch = state
            .canvas_devices
            .iter_mut()
            .find(|item| item.r#type == CanvasDeviceType::Switch)
            .unwrap();
        switch
            .state
            .set_single_signal(Some("sig_driven".to_string()));
        switch.state.is_on = true;

        let led = state
            .canvas_devices
            .iter_mut()
            .find(|item| item.r#type == CanvasDeviceType::Led)
            .unwrap();
        led.state.set_single_signal(Some("sig_driven".to_string()));
        led.state.is_on = false;

        state.canvas_devices.push(CanvasDeviceSnapshot {
            id: "led-extra".to_string(),
            r#type: CanvasDeviceType::Led,
            x: 0.0,
            y: 0.0,
            label: "LED Extra".to_string(),
            state: CanvasDeviceStateSnapshot {
                is_on: true,
                color: Some("green".to_string()),
                binding: single_binding(Some("sig_receiver")),
                config: no_config(),
            },
        });
    }

    let mut topology_cache = SignalTopologyCache::default();
    let mut signal_catalog = SignalCatalog::default();
    let mut pending_catalog_updates = Vec::new();

    let sample = runtime.collect_data_sample(
        &mut topology_cache,
        &mut signal_catalog,
        &mut pending_catalog_updates,
    );

    assert_eq!(sample.values.len(), 2);
    let by_id: HashMap<u16, bool> = sample.values.into_iter().collect();
    let driven_id = signal_catalog.by_signal.get("sig_driven").copied().unwrap();
    let receiver_id = signal_catalog
        .by_signal
        .get("sig_receiver")
        .copied()
        .unwrap();

    assert_eq!(by_id.get(&driven_id), Some(&true));
    assert_eq!(by_id.get(&receiver_id), Some(&true));
}

#[test]
fn filter_changed_updates_skips_steady_windows() {
    let mut last_latest = HashMap::new();

    let first = HardwareRuntime::filter_changed_updates(
        vec![
            HardwareSignalAggregateByIdV1 {
                signal_id: 1,
                latest: true,
                high_ratio: 1.0,
                edge_count: 0,
            },
            HardwareSignalAggregateByIdV1 {
                signal_id: 2,
                latest: false,
                high_ratio: 0.0,
                edge_count: 0,
            },
        ],
        &mut last_latest,
    );
    assert_eq!(first.len(), 2);

    let second = HardwareRuntime::filter_changed_updates(
        vec![
            HardwareSignalAggregateByIdV1 {
                signal_id: 1,
                latest: true,
                high_ratio: 1.0,
                edge_count: 0,
            },
            HardwareSignalAggregateByIdV1 {
                signal_id: 2,
                latest: false,
                high_ratio: 0.0,
                edge_count: 0,
            },
        ],
        &mut last_latest,
    );
    assert!(second.is_empty());

    let third = HardwareRuntime::filter_changed_updates(
        vec![HardwareSignalAggregateByIdV1 {
            signal_id: 1,
            latest: true,
            high_ratio: 0.5,
            edge_count: 2,
        }],
        &mut last_latest,
    );
    assert_eq!(third.len(), 1);
}

#[test]
fn aggregate_read_buffer_skips_unmapped_slots() {
    let updates = HardwareRuntime::aggregate_read_buffer(
        &[0b0000_0000_0000_0101],
        &[1, super::stream::UNMAPPED_SIGNAL_ID, 2],
        1,
    );

    assert_eq!(updates.len(), 2);
    assert_eq!(updates[0].signal_id, 1);
    assert!(updates[0].latest);
    assert_eq!(updates[1].signal_id, 2);
    assert!(updates[1].latest);
}

#[test]
fn effective_batch_cycles_scales_with_target_rate() {
    let max_wait = Duration::from_micros(2_000);

    assert_eq!(
        HardwareRuntime::effective_batch_cycles(50_000.0, 128, 256, max_wait),
        128
    );
    assert_eq!(
        HardwareRuntime::effective_batch_cycles(100_000.0, 128, 256, max_wait),
        200
    );
    assert_eq!(
        HardwareRuntime::effective_batch_cycles(825_000.0, 128, 256, max_wait),
        256
    );
}

#[test]
fn expected_cycles_reanchor_after_rate_change() {
    let completed_cycles =
        HardwareRuntime::expected_cycles_for_elapsed(0, Duration::from_secs(1), 100_000.0);

    assert_eq!(completed_cycles, 100_000);

    let lowered_expected = HardwareRuntime::expected_cycles_for_elapsed(
        completed_cycles,
        Duration::from_millis(2),
        10_000.0,
    );

    assert_eq!(lowered_expected.saturating_sub(completed_cycles), 20);
}

#[test]
fn device_capability_registry_marks_drivers_and_receivers() {
    assert!(HardwareRuntime::device_drives_signal(
        CanvasDeviceType::Switch
    ));
    assert!(!HardwareRuntime::device_receives_signal(
        CanvasDeviceType::Switch
    ));
    assert!(!HardwareRuntime::device_drives_signal(
        CanvasDeviceType::TextLcd
    ));
    assert!(HardwareRuntime::device_receives_signal(
        CanvasDeviceType::TextLcd
    ));
}

#[test]
fn input_encoders_follow_live_device_state_without_recompiling() {
    let mut state = HardwareStateV1 {
        canvas_devices: vec![CanvasDeviceSnapshot {
            id: "switch0".to_string(),
            r#type: CanvasDeviceType::Switch,
            x: 0.0,
            y: 0.0,
            label: "Switch".to_string(),
            state: CanvasDeviceStateSnapshot {
                is_on: true,
                color: None,
                binding: single_binding(Some("sig_a")),
                config: no_config(),
            },
        }],
        ..HardwareStateV1::default()
    };
    state.canvas_devices.truncate(1);

    let signal_order = vec!["sig_a".to_string(), "sig_b".to_string()];
    let encoders = HardwareRuntime::compile_input_encoders(&state, &signal_order);
    let mut frame_words = vec![0u16; 1];

    HardwareRuntime::fill_write_frame(&state, &encoders, &mut frame_words);
    assert_eq!(frame_words, vec![0b0000_0001u16]);

    state.canvas_devices[0].state.is_on = false;
    HardwareRuntime::fill_write_frame(&state, &encoders, &mut frame_words);
    assert_eq!(frame_words, vec![0u16]);
}

#[test]
fn button_input_encoder_honors_active_low_polarity() {
    let state = HardwareStateV1 {
        canvas_devices: vec![CanvasDeviceSnapshot {
            id: "button0".to_string(),
            r#type: CanvasDeviceType::Button,
            x: 0.0,
            y: 0.0,
            label: "Button".to_string(),
            state: CanvasDeviceStateSnapshot {
                is_on: false,
                color: None,
                binding: single_binding(Some("sig_a")),
                config: button_config(true),
            },
        }],
        ..HardwareStateV1::default()
    };

    let signal_order = vec!["sig_a".to_string()];
    let encoders = HardwareRuntime::compile_input_encoders(&state, &signal_order);
    let mut frame_words = vec![0u16; 1];

    HardwareRuntime::fill_write_frame(&state, &encoders, &mut frame_words);
    assert_eq!(frame_words, vec![0b0000_0001u16]);
}

#[test]
fn segment_display_decoder_uses_dynamic_digit_count() {
    let mut state = HardwareStateV1 {
        canvas_devices: vec![CanvasDeviceSnapshot {
            id: "seg0".to_string(),
            r#type: CanvasDeviceType::SegmentDisplay,
            x: 0.0,
            y: 0.0,
            label: "SEG".to_string(),
            state: CanvasDeviceStateSnapshot {
                is_on: false,
                color: None,
                binding: slot_bindings(&[
                    Some("seg_a"),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some("digit_1"),
                ]),
                config: CanvasDeviceConfigSnapshot::SegmentDisplay {
                    digits: 6,
                    active_low: false,
                },
            },
        }],
        ..HardwareStateV1::default()
    };
    state.canvas_devices.truncate(1);

    let signal_order = vec!["seg_a".to_string(), "digit_1".to_string()];
    let mut decoders = HardwareRuntime::compile_output_decoders(&state, &signal_order);
    let read_buffer = vec![0b0000_0011u16];

    HardwareRuntime::ingest_output_batch(&read_buffer, 1, &mut decoders);
    let snapshot = HardwareRuntime::flush_output_decoders(&mut decoders, 1);

    assert_eq!(snapshot.devices.len(), 1);
    let segment = &snapshot.devices[0];
    assert!(segment.latest);
    assert_eq!(segment.segment_mask, Some(1));
    assert_eq!(segment.digit_segment_masks, vec![1, 0, 0, 0, 0, 0]);
}

#[test]
fn segment_display_decoder_honors_active_low_polarity() {
    let mut state = HardwareStateV1 {
        canvas_devices: vec![CanvasDeviceSnapshot {
            id: "seg_low".to_string(),
            r#type: CanvasDeviceType::SegmentDisplay,
            x: 0.0,
            y: 0.0,
            label: "SEG".to_string(),
            state: CanvasDeviceStateSnapshot {
                is_on: false,
                color: None,
                binding: slot_bindings(&[Some("seg_a")]),
                config: CanvasDeviceConfigSnapshot::SegmentDisplay {
                    digits: 1,
                    active_low: true,
                },
            },
        }],
        ..HardwareStateV1::default()
    };
    state.canvas_devices.truncate(1);

    let signal_order = vec!["seg_a".to_string()];
    let mut decoders = HardwareRuntime::compile_output_decoders(&state, &signal_order);
    let read_buffer = vec![0u16];

    HardwareRuntime::ingest_output_batch(&read_buffer, 1, &mut decoders);
    let snapshot = HardwareRuntime::flush_output_decoders(&mut decoders, 1);

    assert_eq!(snapshot.devices.len(), 1);
    let segment = &snapshot.devices[0];
    assert_eq!(segment.segment_mask, Some(1));
}

#[test]
fn matrix_decoder_normalizes_scanned_pixels_by_row_activity() {
    let mut state = HardwareStateV1 {
        canvas_devices: vec![CanvasDeviceSnapshot {
            id: "matrix0".to_string(),
            r#type: CanvasDeviceType::LedMatrix,
            x: 0.0,
            y: 0.0,
            label: "Matrix".to_string(),
            state: CanvasDeviceStateSnapshot {
                is_on: false,
                color: None,
                binding: slot_bindings(&[
                    Some("row_1"),
                    Some("row_2"),
                    Some("col_1"),
                    Some("col_2"),
                ]),
                config: CanvasDeviceConfigSnapshot::LedMatrix {
                    rows: 2,
                    columns: 2,
                },
            },
        }],
        ..HardwareStateV1::default()
    };
    state.canvas_devices.truncate(1);
    let signal_order = vec![
        "row_1".to_string(),
        "row_2".to_string(),
        "col_1".to_string(),
        "col_2".to_string(),
    ];
    let mut decoders = HardwareRuntime::compile_output_decoders(&state, &signal_order);
    let read_buffer = vec![
        0b0000_0101u16,
        0b0000_1010u16,
        0b0000_1001u16,
        0b0000_0110u16,
    ];

    HardwareRuntime::ingest_output_batch(&read_buffer, 1, &mut decoders);
    let snapshot = HardwareRuntime::flush_output_decoders(&mut decoders, 1);

    assert_eq!(snapshot.devices.len(), 1);
    let matrix = &snapshot.devices[0];
    assert_eq!(matrix.pixel_columns, 2);
    assert_eq!(matrix.pixel_rows, 2);
    assert_eq!(matrix.pixels, vec![128, 128, 128, 128]);
    assert!(matrix.latest);
}
