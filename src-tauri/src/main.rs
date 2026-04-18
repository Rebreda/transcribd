#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[tauri::command]
fn health() -> &'static str {
    "ok"
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistClipRequest {
    audio_base64: String,
    transcript: String,
    title: String,
    notes: String,
    categories: Vec<String>,
    started_at_ms: i64,
    ended_at_ms: i64,
    sample_rate: u32,
    channels: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestClip {
    id: String,
    file_name: String,
    created_at_ms: i64,
    started_at_ms: i64,
    ended_at_ms: i64,
    duration_ms: i64,
    sample_rate: u32,
    channels: u16,
    transcript: String,
    title: String,
    notes: String,
    categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    updated_at_ms: i64,
    clips: Vec<ManifestClip>,
}

#[tauri::command]
fn get_manifest(app: AppHandle) -> Result<Manifest, String> {
    load_manifest(&app)
}

#[tauri::command]
fn persist_clip(app: AppHandle, payload: PersistClipRequest) -> Result<ManifestClip, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to locate app data dir: {error}"))?;
    let clips_dir = app_data_dir.join("clips");

    fs::create_dir_all(&clips_dir)
        .map_err(|error| format!("failed to create clips directory: {error}"))?;

    let clip_id = format!("clip-{}", now_ms());
    let file_name = format!("{clip_id}.wav");
    let clip_path = clips_dir.join(&file_name);

    let bytes = BASE64
        .decode(payload.audio_base64.as_bytes())
        .map_err(|error| format!("invalid base64 audio payload: {error}"))?;

    fs::write(&clip_path, bytes).map_err(|error| format!("failed to write clip file: {error}"))?;

    let mut manifest = load_manifest(&app)?;
    let created_at = now_ms();
    let duration_ms = (payload.ended_at_ms - payload.started_at_ms).max(0);

    let clip = ManifestClip {
        id: clip_id,
        file_name,
        created_at_ms: created_at,
        started_at_ms: payload.started_at_ms,
        ended_at_ms: payload.ended_at_ms,
        duration_ms,
        sample_rate: payload.sample_rate,
        channels: payload.channels,
        transcript: payload.transcript,
        title: payload.title,
        notes: payload.notes,
        categories: payload.categories,
    };

    manifest.updated_at_ms = created_at;
    manifest.clips.push(clip.clone());
    save_manifest(&app, &manifest)?;

    Ok(clip)
}

fn manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to locate app data dir: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create app data dir: {error}"))?;
    Ok(dir.join("manifest.json"))
}

fn load_manifest(app: &AppHandle) -> Result<Manifest, String> {
    let path = manifest_path(app)?;
    if !Path::new(&path).exists() {
        return Ok(Manifest {
            version: 1,
            updated_at_ms: now_ms(),
            clips: Vec::new(),
        });
    }

    let raw = fs::read_to_string(&path).map_err(|error| format!("failed to read manifest: {error}"))?;
    serde_json::from_str::<Manifest>(&raw)
        .map_err(|error| format!("failed to parse manifest JSON: {error}"))
}

fn save_manifest(app: &AppHandle, manifest: &Manifest) -> Result<(), String> {
    let path = manifest_path(app)?;
    let raw = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("failed to serialize manifest: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("failed to write manifest: {error}"))
}

fn now_ms() -> i64 {
    let Ok(duration) = SystemTime::now().duration_since(UNIX_EPOCH) else {
        return 0;
    };
    duration.as_millis() as i64
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![health, get_manifest, persist_clip])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
