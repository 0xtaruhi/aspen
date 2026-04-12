use std::{
    collections::HashMap,
    process::{Child, ExitStatus},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[derive(Default)]
pub struct HardwareJobRegistry {
    synthesis: Mutex<HashMap<String, Arc<SynthesisJobHandle>>>,
    implementation: Mutex<HashMap<String, Arc<ImplementationJobHandle>>>,
}

impl HardwareJobRegistry {
    pub fn register_synthesis(&self, op_id: &str) -> Result<Arc<SynthesisJobHandle>, String> {
        let mut jobs = self
            .synthesis
            .lock()
            .map_err(|_| "failed to acquire synthesis job registry".to_string())?;
        if jobs.contains_key(op_id) {
            return Err(format!("Synthesis job '{op_id}' is already running"));
        }

        let job = Arc::new(SynthesisJobHandle::default());
        jobs.insert(op_id.to_string(), Arc::clone(&job));
        Ok(job)
    }

    pub fn finish_synthesis(&self, op_id: &str) {
        if let Ok(mut jobs) = self.synthesis.lock() {
            jobs.remove(op_id);
        }
    }

    pub fn cancel_synthesis(&self, op_id: &str) -> Result<bool, String> {
        let job = {
            let jobs = self
                .synthesis
                .lock()
                .map_err(|_| "failed to acquire synthesis job registry".to_string())?;
            jobs.get(op_id).cloned()
        };
        let Some(job) = job else {
            return Ok(false);
        };

        job.request_cancel();
        Ok(true)
    }

    pub fn register_implementation(
        &self,
        op_id: &str,
    ) -> Result<Arc<ImplementationJobHandle>, String> {
        let mut jobs = self
            .implementation
            .lock()
            .map_err(|_| "failed to acquire implementation job registry".to_string())?;
        if jobs.contains_key(op_id) {
            return Err(format!("Implementation job '{op_id}' is already running"));
        }

        let job = Arc::new(ImplementationJobHandle::default());
        jobs.insert(op_id.to_string(), Arc::clone(&job));
        Ok(job)
    }

    pub fn finish_implementation(&self, op_id: &str) {
        if let Ok(mut jobs) = self.implementation.lock() {
            jobs.remove(op_id);
        }
    }

    pub fn cancel_implementation(&self, op_id: &str) -> Result<bool, String> {
        let job = {
            let jobs = self
                .implementation
                .lock()
                .map_err(|_| "failed to acquire implementation job registry".to_string())?;
            jobs.get(op_id).cloned()
        };
        let Some(job) = job else {
            return Ok(false);
        };

        job.request_cancel();
        Ok(true)
    }
}

#[derive(Default)]
pub struct SynthesisJobHandle {
    cancelled: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl SynthesisJobHandle {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub fn request_cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
    }

    pub fn attach_child(&self, mut child: Child) -> Result<(), String> {
        if self.is_cancelled() {
            let _ = child.kill();
        }

        let mut guard = self
            .child
            .lock()
            .map_err(|_| "failed to acquire synthesis process handle".to_string())?;
        *guard = Some(child);
        Ok(())
    }

    pub fn wait_for_exit(&self) -> Result<ExitStatus, String> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| "failed to acquire synthesis process handle".to_string())?
            .take()
            .ok_or_else(|| "synthesis process handle is missing".to_string())?;
        child.wait().map_err(|err| err.to_string())
    }
}

#[derive(Default)]
pub struct ImplementationJobHandle {
    cancelled: AtomicBool,
}

impl ImplementationJobHandle {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub fn request_cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}
