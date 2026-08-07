#![allow(linker_messages)]

mod dir;
mod pty;
mod screenshot;

use tauri::{LogicalSize, Manager};

/// The screen the window sizes were chosen against.
const REF_SCREEN: (f64, f64) = (1920.0, 1080.0);
/// Smallest usable window on `REF_SCREEN` — below this the block chrome and the
/// docked input bar stop fitting side by side.
const REF_MIN: (f64, f64) = (690.0, 560.0);
/// What it opens at on `REF_SCREEN`.
const REF_START: (f64, f64) = (1060.0, 620.0);
/// No startup window covers more than this much of the screen it opens on.
const MAX_SCREEN_SHARE: f64 = 0.9;

/// Scale a reference size to this monitor, as a fraction of the screen.
///
/// Everything here is in **logical** pixels, which is what makes this correct
/// on HiDPI without a special case: Windows reports a 3840x2160 display at 200%
/// as 1920x1080 logical, so a 4K screen scales like the 1080p one it visually
/// is, rather than demanding a 2760px-wide minimum.
fn scaled(reference: (f64, f64), screen: (f64, f64)) -> LogicalSize<f64> {
    LogicalSize::new(
        reference.0 * screen.0 / REF_SCREEN.0,
        reference.1 * screen.1 / REF_SCREEN.1,
    )
}

/// Scale the window to this monitor. Every failure path leaves it at the
/// tauri.conf.json values — a window that opens at the reference size beats one
/// that fails to open.
fn size_window(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let screen = (
        monitor.size().width as f64 / scale,
        monitor.size().height as f64 / scale,
    );

    let min = scaled(REF_MIN, screen);
    let mut start = scaled(REF_START, screen);
    // A screen small enough that the scaled startup size would fill it is one
    // where the window should be smaller than the formula says, not one where
    // it should overhang the desktop.
    start.width = start.width.min(screen.0 * MAX_SCREEN_SHARE).max(min.width);
    start.height = start.height.min(screen.1 * MAX_SCREEN_SHARE).max(min.height);

    let _ = window.set_min_size(Some(min));
    let _ = window.set_size(start);
    let _ = window.center();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Before anything touches the window: the shell takes a few hundred
            // milliseconds to reach its first prompt, and none of that has to
            // wait for the webview. Started here, it boots alongside it, and the
            // output is buffered until the frontend attaches. Failure is not
            // fatal — `pty_attach` starts one itself if this did not.
            let _ = pty::start(
                &app.state::<pty::PtyState>(),
                pty::EARLY_SIZE.0,
                pty::EARLY_SIZE.1,
                None,
            );

            if let Some(window) = app.get_webview_window("main") {
                size_window(&window);
                // The window is created hidden (`visible: false` in
                // tauri.conf.json) so the sizing above is not a visible jump. It
                // used to open at the config size, then resize, then re-centre,
                // all on screen — the window moving three times before the app
                // had drawn anything, which is a good part of what startup
                // *felt* like.
                let _ = window.show();
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            dir::list_dir,
            screenshot::screenshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
