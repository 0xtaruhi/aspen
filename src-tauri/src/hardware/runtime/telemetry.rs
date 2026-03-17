use std::collections::HashMap;

use crate::hardware::types::{HardwareDataSignalCatalogEntryV1, HardwareSignalAggregateByIdV1};

use super::*;

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
            latest: false,
            high_count: 0,
            total_count: 0,
            edge_count: 0,
            previous: None,
        }
    }

    pub(super) fn ingest(&mut self, value: bool) {
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
    pub(super) fn aggregate_read_buffer(
        read_buffer: &[u16],
        signal_ids: &[u16],
        words_per_cycle: usize,
    ) -> Vec<HardwareSignalAggregateByIdV1> {
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

                Some(aggregate.into_signal(signal_id))
            })
            .collect::<Vec<_>>();

        if updates.len() > DATA_MAX_UPDATES_PER_BATCH {
            updates.truncate(DATA_MAX_UPDATES_PER_BATCH);
        }

        updates
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
        sequence: u64,
        generated_at_ms: u64,
        dropped_samples: u64,
        queue_fill: u16,
        queue_capacity: u16,
        batch_cycles: u16,
        updates: &[HardwareSignalAggregateByIdV1],
    ) -> Vec<u8> {
        let updates_count = updates.len() as u16;
        let mut payload = Vec::with_capacity(32 + updates.len() * 9);
        payload.extend_from_slice(&sequence.to_le_bytes());
        payload.extend_from_slice(&generated_at_ms.to_le_bytes());
        payload.extend_from_slice(&dropped_samples.to_le_bytes());
        payload.extend_from_slice(&queue_fill.to_le_bytes());
        payload.extend_from_slice(&queue_capacity.to_le_bytes());
        payload.extend_from_slice(&batch_cycles.to_le_bytes());
        payload.extend_from_slice(&updates_count.to_le_bytes());

        for update in updates {
            payload.extend_from_slice(&update.signal_id.to_le_bytes());
            payload.push(u8::from(update.latest));
            payload.extend_from_slice(&update.high_ratio.to_le_bytes());
            payload.extend_from_slice(&update.edge_count.to_le_bytes());
        }

        payload
    }
}
