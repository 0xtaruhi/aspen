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

    #[test]
    fn extracts_string_and_str_panic_messages() {
        assert_eq!(panic_message(Box::new("str panic")), "str panic");
        assert_eq!(
            panic_message(Box::new("owned panic".to_string())),
            "owned panic"
        );
    }
}
