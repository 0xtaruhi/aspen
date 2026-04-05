use tauri::{AppHandle, Emitter};

use crate::hardware::types::ImplementationLogChunkV1;

use super::{now_millis, ImplementationStageKindV1};

pub(super) fn emit_log_chunk(
    app: &AppHandle,
    op_id: &str,
    stage: ImplementationStageKindV1,
    chunk: String,
    fallback_timestamp_ms: u64,
) {
    let generated_at_ms = now_millis().unwrap_or(fallback_timestamp_ms);
    let _ = app.emit(
        "hardware:implementation_log",
        ImplementationLogChunkV1 {
            version: 1,
            op_id: op_id.to_string(),
            stage,
            chunk,
            generated_at_ms,
        },
    );
}
