use std::{
    any::Any,
    sync::{atomic::AtomicBool, mpsc, Arc},
    thread::{self, JoinHandle},
};

use tauri::AppHandle;

use super::*;

pub(super) struct DecodeWorker {
    sender: Option<mpsc::SyncSender<StreamDecodeMessage>>,
    handle: Option<JoinHandle<()>>,
}

impl DecodeWorker {
    pub(super) fn spawn(
        runtime: Arc<HardwareRuntime>,
        app: AppHandle,
        stop_flag: Arc<AtomicBool>,
        free_buffer_tx: mpsc::SyncSender<Vec<u16>>,
    ) -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel(STREAM_DECODE_QUEUE_CAPACITY);
        let handle = thread::Builder::new()
            .name("aspen-hardware-decode".to_string())
            .spawn(move || {
                runtime.run_decode_loop(app, stop_flag, receiver, free_buffer_tx);
            })
            .map_err(|err| format!("failed to start decode thread: {err}"))?;

        Ok(Self {
            sender: Some(sender),
            handle: Some(handle),
        })
    }

    pub(super) fn send(&self, message: StreamDecodeMessage) -> Result<(), String> {
        self.sender
            .as_ref()
            .ok_or_else(|| "decode worker is already stopped".to_string())?
            .send(message)
            .map_err(|_| "decode thread disconnected".to_string())
    }

    pub(super) fn shutdown(mut self) -> Result<(), String> {
        if let Some(sender) = self.sender.take() {
            // A disconnected receiver is also a valid shutdown state: the stop
            // flag can let the worker exit before this control message arrives.
            let _ = sender.send(StreamDecodeMessage::Shutdown);
        }

        self.handle
            .take()
            .and_then(|handle| handle.join().err())
            .map(|panic| format!("decode thread panicked: {}", panic_message(panic)))
            .map_or(Ok(()), Err)
    }
}

fn panic_message(panic: Box<dyn Any + Send + 'static>) -> String {
    if let Some(message) = panic.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = panic.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic payload".to_string()
}

impl HardwareRuntime {
    pub(super) fn record_data_stream_error(&self, error: impl Into<String>) {
        let error = error.into();
        if let Err(status_error) = self.update_data_stream_status(|status| {
            status.running = false;
            status.last_error = Some(match status.last_error.take() {
                Some(previous) if previous != error => format!("{previous}; {error}"),
                Some(previous) => previous,
                None => error,
            });
        }) {
            eprintln!("failed to record data stream error: {status_error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::types::{
        CanvasDeviceBindingSnapshot, CanvasDeviceConfigSnapshot, CanvasDeviceDataSnapshot,
        CanvasDeviceSnapshot, CanvasDeviceStateSnapshot, CanvasDeviceType, CanvasHd44780BusMode,
        HardwareCanvasDeviceTelemetryPayload, HardwareStateV1,
    };

    #[test]
    fn extracts_string_and_str_panic_messages() {
        assert_eq!(panic_message(Box::new("str panic")), "str panic");
        assert_eq!(
            panic_message(Box::new("owned panic".to_string())),
            "owned panic"
        );
    }

    #[test]
    fn output_decoder_cache_preserves_lcd_state_across_stream_pause() {
        fn lcd_cycle(rs: bool, enable: bool, byte: u8) -> u16 {
            let mut cycle = 0_u16;
            if rs {
                cycle |= 1;
            }
            if enable {
                cycle |= 1 << 1;
            }
            cycle | u16::from(byte) << 3
        }

        fn append_lcd_byte(read_buffer: &mut Vec<u16>, rs: bool, byte: u8) {
            read_buffer.push(lcd_cycle(rs, true, byte));
            read_buffer.push(lcd_cycle(rs, false, byte));
        }

        let state = HardwareStateV1 {
            canvas_devices: vec![CanvasDeviceSnapshot {
                id: "lcd0".to_string(),
                r#type: CanvasDeviceType::Hd44780Lcd,
                x: 0.0,
                y: 0.0,
                label: "LCD".to_string(),
                state: CanvasDeviceStateSnapshot {
                    is_on: false,
                    color: None,
                    binding: CanvasDeviceBindingSnapshot::Slots {
                        signals: [
                            "rs", "e", "rw", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7",
                        ]
                        .map(|signal| Some(signal.to_string()))
                        .to_vec(),
                    },
                    config: CanvasDeviceConfigSnapshot::Hd44780Lcd {
                        columns: 16,
                        rows: 2,
                        bus_mode: CanvasHd44780BusMode::EightBit,
                    },
                    data: CanvasDeviceDataSnapshot::None,
                },
            }],
            ..HardwareStateV1::default()
        };
        let signal_order = [
            "rs", "e", "rw", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7",
        ]
        .map(str::to_string)
        .to_vec();
        let signature = HardwareRuntime::output_decoder_signature(&state, &signal_order);
        let mut decoders = HardwareRuntime::compile_output_decoders(&state, &signal_order);
        let mut initial_writes = Vec::new();
        append_lcd_byte(&mut initial_writes, false, 0x0c);
        append_lcd_byte(&mut initial_writes, false, 0x80);
        append_lcd_byte(&mut initial_writes, true, b'A');
        HardwareRuntime::ingest_output_batch(&initial_writes, 1, &mut decoders);

        let runtime = HardwareRuntime::default();
        runtime.store_output_decoder_cache(OutputDecoderCache {
            signature,
            decoders,
        });
        let mut resumed = runtime.take_output_decoder_cache();
        assert_eq!(resumed.signature, signature);

        HardwareRuntime::ingest_output_batch(&[0; 32], 1, &mut resumed.decoders);
        let snapshot = HardwareRuntime::flush_output_decoders(&mut resumed.decoders, 1);
        let HardwareCanvasDeviceTelemetryPayload::TextLines { lines } =
            &snapshot.devices[0].payload
        else {
            panic!("expected LCD text lines");
        };

        assert_eq!(lines[0], "A               ");
    }
}
