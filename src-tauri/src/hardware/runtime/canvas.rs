#[cfg(test)]
use std::collections::{HashMap, VecDeque};

#[cfg(test)]
use crate::hardware::types::HardwareSignalAggregateByIdV1;
use crate::hardware::types::{CanvasDeviceType, HardwareStateV1};

use super::registry::capabilities_for_device_type;
use super::*;

impl HardwareRuntime {
    #[cfg(test)]
    pub(super) fn collect_data_sample(
        &self,
        topology_cache: &mut SignalTopologyCache,
        signal_catalog: &mut SignalCatalog,
        pending_catalog_updates: &mut Vec<crate::hardware::types::HardwareDataSignalCatalogEntryV1>,
    ) -> HardwareDataSample {
        let values = match self.state.lock() {
            Ok(state) => {
                Self::refresh_signal_topology_cache(
                    &state,
                    topology_cache,
                    signal_catalog,
                    pending_catalog_updates,
                );

                let mut values = Vec::with_capacity(topology_cache.routes.len());
                for route in &topology_cache.routes {
                    let index = route.source_index.or(route.fallback_index);
                    if let Some(index) = index {
                        values.push((
                            route.signal_id,
                            state.canvas_devices[index].state.driven_signal_level(),
                        ));
                    }
                }
                values
            }
            Err(_) => Vec::new(),
        };

        HardwareDataSample { values }
    }

    #[cfg(test)]
    pub(super) fn aggregate_data_samples(
        queue: &mut VecDeque<HardwareDataSample>,
    ) -> Vec<HardwareSignalAggregateByIdV1> {
        let mut aggregated: HashMap<u16, HardwareDataAggregate> = HashMap::new();

        while let Some(sample) = queue.pop_front() {
            for (signal_id, value) in sample.values {
                aggregated
                    .entry(signal_id)
                    .or_insert_with(HardwareDataAggregate::new)
                    .ingest(value);
            }
        }

        let mut updates: Vec<HardwareSignalAggregateByIdV1> = aggregated
            .into_iter()
            .map(|(signal_id, aggregate)| aggregate.into_signal(signal_id))
            .collect();
        if updates.len() > DATA_MAX_UPDATES_PER_BATCH {
            updates.sort_by(|left, right| left.signal_id.cmp(&right.signal_id));
            updates.truncate(DATA_MAX_UPDATES_PER_BATCH);
        }
        updates
    }

    #[cfg(test)]
    fn refresh_signal_topology_cache(
        state: &HardwareStateV1,
        topology_cache: &mut SignalTopologyCache,
        signal_catalog: &mut SignalCatalog,
        pending_catalog_updates: &mut Vec<crate::hardware::types::HardwareDataSignalCatalogEntryV1>,
    ) {
        let signature = Self::signal_topology_signature(state);
        if topology_cache.signature == signature {
            return;
        }

        #[derive(Default)]
        struct RouteDraft {
            source_index: Option<usize>,
            fallback_index: Option<usize>,
        }

        let mut drafts: HashMap<String, RouteDraft> = HashMap::new();

        for (index, device) in state.canvas_devices.iter().enumerate() {
            let Some(signal) = device.state.single_signal() else {
                continue;
            };

            let draft = drafts.entry(signal.to_string()).or_default();
            if Self::device_drives_signal(device.r#type) && draft.source_index.is_none() {
                draft.source_index = Some(index);
            }

            if Self::device_receives_signal(device.r#type) && draft.fallback_index.is_none() {
                draft.fallback_index = Some(index);
            }
        }

        let mut routes = Vec::with_capacity(drafts.len());
        for (signal, draft) in drafts {
            let signal_id = signal_catalog.id_for_signal(&signal, pending_catalog_updates);
            routes.push(SignalRoute {
                signal,
                signal_id,
                source_index: draft.source_index,
                fallback_index: draft.fallback_index,
            });
        }

        routes.sort_by(|left, right| left.signal.cmp(&right.signal));
        topology_cache.signature = signature;
        topology_cache.routes = routes;
    }

    #[cfg(test)]
    fn signal_topology_signature(state: &HardwareStateV1) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        use std::hash::{Hash, Hasher};

        state.canvas_devices.len().hash(&mut hasher);
        for device in &state.canvas_devices {
            device.id.hash(&mut hasher);
            device.r#type.hash(&mut hasher);
            device.state.binding.hash(&mut hasher);
            device.state.config.hash(&mut hasher);
        }
        hasher.finish()
    }

    pub(super) fn find_canvas_device_index(state: &HardwareStateV1, id: &str) -> Option<usize> {
        state.canvas_devices.iter().position(|item| item.id == id)
    }

    pub(super) fn device_drives_signal(device_type: CanvasDeviceType) -> bool {
        capabilities_for_device_type(device_type).drives_signal
    }

    pub(super) fn device_receives_signal(device_type: CanvasDeviceType) -> bool {
        capabilities_for_device_type(device_type).receives_signal
    }

    fn signal_source_value(state: &HardwareStateV1, signal: &str) -> Option<bool> {
        state
            .canvas_devices
            .iter()
            .find(|candidate| {
                Self::device_drives_signal(candidate.r#type)
                    && candidate.state.single_signal() == Some(signal)
            })
            .map(|candidate| candidate.state.driven_signal_level())
    }

    pub(super) fn propagate_signal_to_subscribers(
        state: &mut HardwareStateV1,
        source_index: usize,
        signal: &str,
        value: bool,
    ) {
        for (candidate_index, candidate) in state.canvas_devices.iter_mut().enumerate() {
            if candidate_index == source_index {
                continue;
            }

            if Self::device_receives_signal(candidate.r#type)
                && candidate.state.single_signal() == Some(signal)
            {
                candidate.state.is_on = value;
            }
        }
    }

    pub(super) fn reconcile_bound_signal(state: &mut HardwareStateV1, target_index: usize) {
        let target = &state.canvas_devices[target_index];
        let target_type = target.r#type;
        let target_value = target.state.driven_signal_level();
        let target_signal = target.state.single_signal().map(ToOwned::to_owned);

        let Some(signal) = target_signal else {
            return;
        };

        if Self::device_drives_signal(target_type) {
            Self::propagate_signal_to_subscribers(state, target_index, &signal, target_value);
            return;
        }

        if Self::device_receives_signal(target_type) {
            if let Some(value) = Self::signal_source_value(state, &signal) {
                state.canvas_devices[target_index].state.is_on = value;
            }
        }
    }
}
