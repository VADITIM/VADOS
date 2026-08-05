//! PTY session backing the terminal view.
//!
//! One session per window. Output is streamed to the frontend as raw bytes over
//! a Tauri channel, untouched — decoding to text is the frontend's job so that
//! multi-byte characters split across reads are not corrupted.
//!
//! OSC 133/7 shell-integration markers are deliberately *not* parsed here. They
//! were, once, and forwarded as events on a second channel — but two channels
//! give no ordering guarantee against each other, so a marker could arrive
//! before the output chunk it referred to and the renderer would file that
//! output under the wrong command. xterm.js parses them instead, via
//! `registerOscHandler`, where the handler fires mid-parse at exactly the right
//! cursor position. This process is a dumb pipe.

use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

#[cfg(not(windows))]
const BASH_INTEGRATION: &str = include_str!("../resources/shell/integration.bash");
#[cfg(not(windows))]
const ZSH_INTEGRATION: &str = include_str!("../resources/shell/integration.zsh");
#[cfg(windows)]
const POWERSHELL_INTEGRATION: &str = include_str!("../resources/shell/integration.ps1");

pub struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<Option<Pty>>);

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Writes a shell-integration snippet to a fresh temp file/dir and returns the
/// path. A new file per launch avoids clashing with a previous session's copy.
#[cfg(not(windows))]
fn write_temp(name: &str, contents: &str) -> Result<std::path::PathBuf, String> {
    let path = std::env::temp_dir().join(format!("vados-{}-{}", name, std::process::id()));
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(windows)]
fn build_shell_command() -> Result<CommandBuilder, String> {
    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.arg("-NoLogo");
    cmd.arg("-NoExit");
    cmd.arg("-Command");
    cmd.arg(POWERSHELL_INTEGRATION);
    Ok(cmd)
}

#[cfg(not(windows))]
fn build_shell_command() -> Result<CommandBuilder, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let shell_name = shell.rsplit('/').next().unwrap_or("bash");

    let mut cmd = CommandBuilder::new(&shell);
    if shell_name == "zsh" {
        // ZDOTDIR override makes zsh read <dir>/.zshrc instead of ~/.zshrc; our
        // snippet sources the real one first.
        let dir = std::env::temp_dir().join(format!("vados-zsh-{}", std::process::id()));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(".zshrc"), ZSH_INTEGRATION).map_err(|e| e.to_string())?;
        cmd.env("ZDOTDIR", dir);
        cmd.arg("-i");
    } else {
        // Fish has no equivalent injection flag — falls back to plain, unintegrated.
        // No OSC 133 events for fish sessions until a manual rc line ships (see tasks.md).
        if shell_name == "fish" {
            return Ok(cmd);
        }
        let rcfile = write_temp("bash-rc", BASH_INTEGRATION)?;
        cmd.arg("--rcfile");
        cmd.arg(rcfile);
        cmd.arg("-i");
    }
    Ok(cmd)
}

#[tauri::command]
pub fn pty_spawn(
    state: State<PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| e.to_string())?;

    let mut cmd = build_shell_command()?;
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The slave handle must be dropped or the reader never sees EOF on exit.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data
                        .send(InvokeResponseBody::Raw(buf[..n].to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        let _ = child.wait();
    });

    *state.0.lock().unwrap() = Some(Pty {
        master: pair.master,
        writer,
    });
    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<PtyState>, data: String) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let pty = guard.as_mut().ok_or("pty not started")?;
    pty.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    pty.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let pty = guard.as_ref().ok_or("pty not started")?;
    pty.master
        .resize(size(cols, rows))
        .map_err(|e| e.to_string())
}
