use std::collections::HashMap;

use crate::hardware::types::{HardwareDataSignalCatalogEntryV1, HardwareSignalAggregateByIdV1};

use super::*;

pub(super) struct BinaryBatchHeader {
    pub(super) sequence: u64,
    pub(super) generated_at_ms: u64,
    pub(super) dropped_samples: u64,
    pub(super) actual_hz: f64,
    pub(super) transfer_rate_hz: f64,
    pub(super) queue_fill: u16,
    pub(super) queue_capacity: u16,
    pub(super) batch_cycles: u16,
}

impl SignalCatalog {
    pub(super) fn id_for_signal(
        &mut self,
        signal: &str,
        pending_catalog_updates: &mut Vec<HardwareDataSignalCatalogEntryV1>,
    ) -> u16 {
        if let Some(id) = self.by_signal.get(signal) {
            return *id;
        }

        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.by_signal.insert(signal.to_string(), id);
        pending_catalog_updates.push(HardwareDataSignalCatalogEntryV1 {
            signal_id: id,
            signal: signal.to_string(),
        });
        id
    }
}

impl HardwareDataAggregate {
    pub(super) fn new() -> Self {
        Self {
            first: None,
            latest: false,
            high_count: 0,
            total_count: 0,
            edge_count: 0,
            previous: None,
        }
    }

    pub(super) fn ingest(&mut self, value: bool) {
        if self.first.is_none() {
            self.first = Some(value);
        }

        if let Some(previous) = self.previous {
            if previous != value {
                self.edge_count = self.edge_count.saturating_add(1);
            }
        }

        self.previous = Some(value);
        self.latest = value;
        if value {
            self.high_count += 1;
        }
        self.total_count += 1;
    }

    pub(super) fn merge(&mut self, next: &Self) {
        if next.total_count == 0 {
            return;
        }

        if self.total_count == 0 {
            *self = next.clone();
            return;
        }

        if let (Some(previous), Some(first)) = (self.previous, next.first) {
            if previous != first {
                self.edge_count = self.edge_count.saturating_add(1);
            }
        }

        self.latest = next.latest;
        self.high_count = self.high_count.saturating_add(next.high_count);
        self.total_count = self.total_count.saturating_add(next.total_count);
        self.edge_count = self.edge_count.saturating_add(next.edge_count);
        self.previous = next.previous;
    }

    pub(super) fn into_signal(self, signal_id: u16) -> HardwareSignalAggregateByIdV1 {
        let high_ratio = if self.total_count == 0 {
            0.0
        } else {
            self.high_count as f32 / self.total_count as f32
        };

        HardwareSignalAggregateByIdV1 {
            signal_id,
            latest: self.latest,
            high_ratio,
            edge_count: self.edge_count,
        }
    }
}

impl HardwareRuntime {
    pub(super) fn aggregate_read_buffer_windows(
        read_buffer: &[u16],
        signal_ids: &[u16],
        words_per_cycle: usize,
    ) -> Vec<(u16, HardwareDataAggregate)> {
        let signal_count = signal_ids.len().min(words_per_cycle * 16);
        if signal_count == 0 {
            return Vec::new();
        }

        let mut aggregates = (0..signal_count)
            .map(|_| HardwareDataAggregate::new())
            .collect::<Vec<_>>();

        for cycle in read_buffer.chunks_exact(words_per_cycle) {
            for (signal_index, aggregate) in aggregates.iter_mut().enumerate().take(signal_count) {
                let word_index = signal_index / 16;
                let bit_index = signal_index % 16;
                let value = cycle
                    .get(word_index)
                    .map(|word| (word & (1u16 << bit_index)) != 0)
                    .unwrap_or(false);
                aggregate.ingest(value);
            }
        }

        let mut updates = aggregates
            .into_iter()
            .enumerate()
            .filter_map(|(signal_index, aggregate)| {
                let signal_id = signal_ids[signal_index];
                if signal_id == super::stream::UNMAPPED_SIGNAL_ID {
                    return None;
                }

                Some((signal_id, aggregate))
            })
            .collect::<Vec<_>>();

        if updates.len() > DATA_MAX_UPDATES_PER_BATCH {
            updates.truncate(DATA_MAX_UPDATES_PER_BATCH);
        }

        updates
    }

    #[cfg(test)]
    pub(super) fn aggregate_read_buffer(
        read_buffer: &[u16],
        signal_ids: &[u16],
        words_per_cycle: usize,
    ) -> Vec<HardwareSignalAggregateByIdV1> {
        Self::aggregate_read_buffer_windows(read_buffer, signal_ids, words_per_cycle)
            .into_iter()
            .map(|(signal_id, aggregate)| aggregate.into_signal(signal_id))
            .collect()
    }

    pub(super) fn filter_changed_updates(
        mut updates: Vec<HardwareSignalAggregateByIdV1>,
        last_latest_by_signal: &mut HashMap<u16, bool>,
    ) -> Vec<HardwareSignalAggregateByIdV1> {
        updates.retain(|update| {
            let previous_latest = last_latest_by_signal.insert(update.signal_id, update.latest);
            update.edge_count > 0
                || previous_latest
                    .map(|value| value != update.latest)
                    .unwrap_or(true)
        });
        updates
    }

    pub(super) fn encode_binary_batch(
        header: &BinaryBatchHeader,
        updates: &[HardwareSignalAggregateByIdV1],
    ) -> Vec<u8> {
        let updates_count = updates.len() as u16;
        let mut payload = Vec::with_capacity(48 + updates.len() * 9);
        payload.extend_from_slice(&header.sequence.to_le_bytes());
        payload.extend_from_slice(&header.generated_at_ms.to_le_bytes());
        payload.extend_from_slice(&header.dropped_samples.to_le_bytes());
        payload.extend_from_slice(&header.actual_hz.to_le_bytes());
        payload.extend_from_slice(&header.transfer_rate_hz.to_le_bytes());
        payload.extend_from_slice(&header.queue_fill.to_le_bytes());
        payload.extend_from_slice(&header.queue_capacity.to_le_bytes());
        payload.extend_from_slice(&header.batch_cycles.to_le_bytes());
        payload.extend_from_slice(&updates_count.to_le_bytes());

        for update in updates {
            payload.extend_from_slice(&update.signal_id.to_le_bytes());
            payload.push(u8::from(update.latest));
            payload.extend_from_slice(&update.high_ratio.to_le_bytes());
            payload.extend_from_slice(&update.edge_count.to_le_bytes());
        }

        payload
    }

    pub(super) fn encode_binary_waveform_batch(
        sequence: u64,
        generated_at_ms: u64,
        actual_hz: f64,
        words_per_cycle: u16,
        batch_cycles: u16,
        flags: u16,
        write_buffer: &[u16],
        read_buffer: &[u16],
    ) -> Vec<u8> {
        // Snapshot payloads must contain an exact tail for both channels. If the
        // buffered words do not match the declared geometry, drop the payload.
        let expected_words = usize::from(words_per_cycle).saturating_mul(usize::from(batch_cycles));
        if write_buffer.len() != expected_words || read_buffer.len() != expected_words {
            return Vec::new();
        }

        let mut payload = Vec::with_capacity(32 + (write_buffer.len() + read_buffer.len()) * 2);
        payload.extend_from_slice(&sequence.to_le_bytes());
        payload.extend_from_slice(&generated_at_ms.to_le_bytes());
        payload.extend_from_slice(&actual_hz.to_le_bytes());
        payload.extend_from_slice(&words_per_cycle.to_le_bytes());
        payload.extend_from_slice(&batch_cycles.to_le_bytes());
        payload.extend_from_slice(&2u16.to_le_bytes());
        payload.extend_from_slice(&flags.to_le_bytes());

        for word in write_buffer {
            payload.extend_from_slice(&word.to_le_bytes());
        }

        for word in read_buffer {
            payload.extend_from_slice(&word.to_le_bytes());
        }

        payload
    }

    pub(super) fn emit_pending_signal_updates(
        app: &AppHandle,
        last_latest_by_signal: &mut HashMap<u16, bool>,
        pending_meta: &mut PendingSignalBatchMeta,
        pending_updates: &mut HashMap<u16, HardwareDataAggregate>,
    ) {
        if pending_updates.is_empty() {
            *pending_meta = PendingSignalBatchMeta::default();
            return;
        }

        let mut updates = pending_updates
            .drain()
            .map(|(signal_id, aggregate)| aggregate.into_signal(signal_id))
            .collect::<Vec<_>>();
        updates.sort_unstable_by_key(|update| update.signal_id);
        let updates = Self::filter_changed_updates(updates, last_latest_by_signal);
        if updates.is_empty() {
            *pending_meta = PendingSignalBatchMeta::default();
            return;
        }

        let payload = Self::encode_binary_batch(
            &BinaryBatchHeader {
                sequence: pending_meta.sequence,
                generated_at_ms: pending_meta.generated_at_ms,
                dropped_samples: pending_meta.dropped_samples,
                actual_hz: pending_meta.actual_hz,
                transfer_rate_hz: pending_meta.transfer_rate_hz,
                queue_fill: pending_meta.queue_fill,
                queue_capacity: pending_meta.queue_capacity,
                batch_cycles: pending_meta.batch_cycles.min(u32::from(u16::MAX)) as u16,
            },
            &updates,
        );
        let _ = app.emit(
            "hardware:data_batch_bin",
            crate::hardware::types::HardwareDataBatchBinaryV1 {
                version: 2,
                payload,
            },
        );
        *pending_meta = PendingSignalBatchMeta::default();
    }
}
