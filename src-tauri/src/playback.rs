//! Audio decode/playback via rodio (symphonia decoder + cpal output).

use std::fs::File;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use rodio::source::Source;
use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub track_id: Option<i64>,
    pub playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
}

pub struct PlaybackEngine {
    _device: MixerDeviceSink,
    player: Player,
    track_id: Option<i64>,
    duration_ms: u64,
}

impl PlaybackEngine {
    pub fn new() -> Result<Self, String> {
        let device = DeviceSinkBuilder::open_default_sink()
            .map_err(|e| format!("open audio device: {e}"))?;
        let player = Player::connect_new(device.mixer());
        Ok(Self {
            _device: device,
            player,
            track_id: None,
            duration_ms: 0,
        })
    }

    pub fn play_file(
        &mut self,
        track_id: i64,
        file_path: &str,
        known_duration_ms: Option<i64>,
    ) -> Result<PlaybackStatus, String> {
        let path = Path::new(file_path);
        if !path.is_file() {
            return Err(format!("file not found: {file_path}"));
        }

        let file = File::open(path).map_err(|e| format!("open audio file: {e}"))?;
        let source = Decoder::try_from(file).map_err(|e| format!("decode audio: {e}"))?;

        let duration_ms = source
            .total_duration()
            .map(|d| d.as_millis() as u64)
            .or_else(|| known_duration_ms.map(|ms| ms.max(0) as u64))
            .unwrap_or(0);

        self.player.stop();
        self.player.append(source);
        self.player.play();

        self.track_id = Some(track_id);
        self.duration_ms = duration_ms;

        Ok(self.status())
    }

    pub fn toggle(&mut self) -> PlaybackStatus {
        if self.track_id.is_none() || self.player.empty() {
            return self.status();
        }

        if self.player.is_paused() {
            self.player.play();
        } else {
            self.player.pause();
        }

        self.status()
    }

    pub fn seek(&mut self, position_ms: u64) -> Result<PlaybackStatus, String> {
        if self.track_id.is_none() || self.player.empty() {
            return Err("nothing is playing".to_string());
        }

        let capped = if self.duration_ms > 0 {
            position_ms.min(self.duration_ms)
        } else {
            position_ms
        };

        self.player
            .try_seek(Duration::from_millis(capped))
            .map_err(|e| format!("seek failed: {e}"))?;

        Ok(self.status())
    }

    pub fn status(&self) -> PlaybackStatus {
        let finished = self.track_id.is_some() && self.player.empty();
        let position_ms = if finished {
            self.duration_ms
        } else {
            self.player.get_pos().as_millis() as u64
        };

        PlaybackStatus {
            track_id: self.track_id,
            playing: self.track_id.is_some() && !self.player.empty() && !self.player.is_paused(),
            position_ms,
            duration_ms: self.duration_ms,
        }
    }
}

/// Lazily opened engine so missing/broken audio devices don't crash startup.
pub type SharedPlayback = Mutex<Option<PlaybackEngine>>;

pub fn with_engine<T>(
    state: &SharedPlayback,
    f: impl FnOnce(&mut PlaybackEngine) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "playback state poisoned".to_string())?;

    if guard.is_none() {
        *guard = Some(PlaybackEngine::new()?);
    }

    f(guard.as_mut().expect("engine just initialized"))
}
