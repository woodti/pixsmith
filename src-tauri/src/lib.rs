use std::path::Path;

use tauri::http::{header, Response, StatusCode};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Shows a native "Save as" dialog and writes the raw request body there.
/// The suggested file name arrives URI-encoded in the `x-name` header.
/// Returns false when the user cancels.
#[tauri::command]
async fn save_file(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| "image.png".into());

    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Some((_, ext)) = name.rsplit_once('.') {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    if let Ok(dir) = app.path().picture_dir() {
        dialog = dialog.set_directory(dir);
    }
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Reads a bundled model for the `models://` protocol. The headers let the page fetch it
/// cross-origin while COOP/COEP isolation is on (needed for threaded inference).
fn model_response(dir: &Path, uri_path: &str) -> Response<Vec<u8>> {
    let name = percent_encoding::percent_decode_str(uri_path.trim_start_matches('/')).decode_utf8_lossy();
    let file = if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        None
    } else {
        std::fs::read(dir.join(name.as_ref())).ok()
    };
    let builder = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("Cross-Origin-Resource-Policy", "cross-origin");
    match file {
        Some(bytes) => builder.header(header::CONTENT_TYPE, "application/octet-stream").body(bytes),
        None => builder.status(StatusCode::NOT_FOUND).body(Vec::new()),
    }
    .unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_file])
        .register_asynchronous_uri_scheme_protocol("models", |ctx, request, responder| {
            let dir = ctx.app_handle().path().resource_dir().unwrap_or_default().join("models");
            let path = request.uri().path().to_string();
            // models are up to ~90 MB, so read them off the main thread
            std::thread::spawn(move || responder.respond(model_response(&dir, &path)));
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
