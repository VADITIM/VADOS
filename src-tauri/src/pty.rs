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
use std::sync::{Arc, Mutex};

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

/// Where the reader thread puts what it reads.
///
/// The shell is started in `setup`, before the webview has finished booting, so
/// that PowerShell's own several-hundred-millisecond startup overlaps the
/// frontend's instead of queueing behind it. That means output can exist before
/// anything is listening for it, and the first prompt is exactly the output that
/// must not be lost — so until the frontend attaches, bytes accumulate here.
pub enum Sink {
    Buffer(Vec<u8>),
    Channel(Channel<InvokeResponseBody>),
}

impl Default for Sink {
    fn default() -> Self {
        Sink::Buffer(Vec::new())
    }
}

/// ponytail: past this the backlog stops growing and further output is dropped.
/// Only reachable if the webview never attaches at all, in which case nothing
/// is going to render it anyway; a shell banner is a few kilobytes.
const BACKLOG_CAP: usize = 256 * 1024;

/// What the shell is started at before the frontend has measured anything. A
/// guess, deliberately close to the startup window's real column count so the
/// reflow when the true size arrives moves as little as possible.
pub const EARLY_SIZE: (u16, u16) = (120, 30);

/// The read buffer, reused for the life of the session. Large on purpose: it is
/// what does the coalescing docs/PERFORMANCE.md asks for. A read that comes back
/// full means the pipe still has more queued, so the loop keeps reading instead
/// of sending — one IPC message for what used to be eight.
const READ_BUF: usize = 65536;

/// The most that may be held back before sending regardless. Under a sustained
/// flood every read comes back full, so without this the loop would accumulate
/// forever and the screen would stop moving.
const FLUSH_MAX: usize = 256 * 1024;

/// How far back to look for the start of an unterminated escape sequence.
/// Anything longer than this is an OSC with a very long payload, and splitting
/// one is better than stalling the stream waiting for a terminator that may
/// never come.
const MAX_HOLD: usize = 1024;

/// Whether `seq`, which starts at an ESC, is a complete sequence.
fn terminated(seq: &[u8]) -> bool {
    match seq.get(1) {
        // An ESC with nothing after it yet.
        None => false,
        // CSI: parameter and intermediate bytes, then a final byte.
        Some(b'[') => seq[2..].iter().any(|&b| (0x40..=0x7e).contains(&b)),
        // OSC, DCS, APC, PM: terminated by BEL or by ST (ESC \).
        Some(b']' | b'P' | b'_' | b'^') => {
            seq.contains(&0x07) || seq.windows(2).skip(1).any(|w| w == [0x1b, b'\\'])
        }
        // Everything else is a two-byte escape and is already whole.
        Some(_) => true,
    }
}

/// Where `buf` can be cut without splitting an escape sequence.
///
/// Coalescing means a sequence that used to arrive whole can now straddle the
/// boundary we choose, which is a boundary that did not exist before and is
/// ours to get right. xterm's parser is a state machine and would survive it,
/// but the split would be an artefact of this buffer rather than of the stream —
/// exactly the class of bug that put OSC parsing in the frontend in the first
/// place.
fn safe_cut(buf: &[u8]) -> usize {
    let floor = buf.len().saturating_sub(MAX_HOLD);
    let mut i = buf.len();
    while i > floor {
        i -= 1;
        if buf[i] != 0x1b {
            continue;
        }
        return if terminated(&buf[i..]) { buf.len() } else { i };
    }
    buf.len()
}

#[derive(Default)]
pub struct PtyState {
    session: Mutex<Option<Pty>>,
    sink: Arc<Mutex<Sink>>,
}

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
fn build_shell_command(_elevate: bool) -> Result<CommandBuilder, String> {
    // `elevate` is unused here by design: Windows elevation happens by
    // relaunching the whole app through UAC before this runs (see `config.rs`),
    // because a process cannot raise its own token and a PTY child inherits it.
    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.arg("-NoLogo");
    cmd.arg("-NoExit");
    cmd.arg("-Command");
    cmd.arg(POWERSHELL_INTEGRATION);
    Ok(cmd)
}

#[cfg(not(windows))]
fn build_shell_command(elevate: bool) -> Result<CommandBuilder, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let shell_name = shell.rsplit('/').next().unwrap_or("bash");

    // Root is the *shell's*, not the app's. `-E` keeps the environment, which
    // is what carries ZDOTDIR and therefore the integration snippet — without
    // it the elevated session silently loses its OSC 133 markers.
    // ponytail: sudo asks on the PTY, which is the one place the user can
    // answer it. pkexec would need a polkit agent and gives no better result.
    let mut cmd = if elevate {
        let mut cmd = CommandBuilder::new("sudo");
        cmd.arg("-E");
        cmd.arg(&shell);
        cmd
    } else {
        CommandBuilder::new(&shell)
    };
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

/// Start the shell if it is not already running.
///
/// Called twice by design: once from `setup`, so the shell boots alongside the
/// webview, and once from `pty_attach` as the fallback for the case where the
/// early start failed. The second call is a no-op whenever the first worked.
pub fn start(
    state: &PtyState,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    elevate: bool,
) -> Result<(), String> {
    let mut session = state.session.lock().unwrap();
    if session.is_some() {
        return Ok(());
    }

    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| e.to_string())?;

    let mut cmd = build_shell_command(elevate)?;
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The slave handle must be dropped or the reader never sees EOF on exit.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let sink = Arc::clone(&state.sink);

    std::thread::spawn(move || {
        let mut buf = vec![0u8; READ_BUF];
        // Held between reads, so a burst that arrives as several reads leaves as
        // one message. There is no timer anywhere in here and there must not be:
        // idle CPU is budgeted at literally zero, and a thread waking every few
        // milliseconds to check whether anything needs flushing spends that
        // budget on a session where nothing is happening. The pipe going quiet
        // *is* the signal — a read that does not fill the buffer means there was
        // nothing more to take, so it flushes immediately and latency is
        // unchanged.
        let mut pending: Vec<u8> = Vec::with_capacity(READ_BUF);
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            pending.extend_from_slice(&buf[..n]);
            if n == buf.len() && pending.len() < FLUSH_MAX {
                continue;
            }
            let cut = safe_cut(&pending);
            if cut == 0 {
                continue;
            }
            let mut sink = sink.lock().unwrap();
            match &mut *sink {
                Sink::Buffer(backlog) => {
                    if backlog.len() + cut <= BACKLOG_CAP {
                        backlog.extend_from_slice(&pending[..cut]);
                    }
                }
                // ponytail: no acknowledgement, so this is not backpressure in
                // the strict sense. It does not need to be — the loop only reads
                // as fast as it sends, and a reader that has stopped reading is
                // what makes the OS pipe block the shell. The queue that could
                // grow without bound is the channel's, and it is fed one message
                // per read rather than per byte. Revisit if a flood is ever
                // measured outrunning the frontend.
                Sink::Channel(channel) => {
                    if channel
                        .send(InvokeResponseBody::Raw(pending[..cut].to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
            }
            drop(sink);
            pending.drain(..cut);
        }
        let _ = child.wait();
    });

    *session = Some(Pty {
        master: pair.master,
        writer,
    });
    Ok(())
}

/// The frontend takes over the output stream. Everything the shell wrote before
/// the webview existed is handed over first, in one chunk and in order — xterm
/// parses it exactly as if it had arrived live, so the first prompt and its OSC
/// markers land the same way every later one does.
#[tauri::command]
pub fn pty_attach(
    app: tauri::AppHandle,
    state: State<PtyState>,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    // Normally a no-op — the shell was started in `setup`. The config is read
    // again rather than passed in because this only runs when that start
    // failed, and a stale copy of the settings is the wrong thing to fall back
    // to on the one path that exists to recover.
    let settings = crate::config::load(&app);
    start(
        &state,
        cols,
        rows,
        crate::config::expand(&settings.shell.cwd),
        settings.system.start_as_admin,
    )?;

    let mut sink = state.sink.lock().unwrap();
    if let Sink::Buffer(backlog) = &mut *sink {
        if !backlog.is_empty() {
            on_data
                .send(InvokeResponseBody::Raw(std::mem::take(backlog)))
                .map_err(|e| e.to_string())?;
        }
    }
    *sink = Sink::Channel(on_data);
    drop(sink);

    // The early start guessed a size; this is the first real one.
    pty_resize(state, cols, rows)
}

#[tauri::command]
pub fn pty_write(state: State<PtyState>, data: String) -> Result<(), String> {
    let mut guard = state.session.lock().unwrap();
    let pty = guard.as_mut().ok_or("pty not started")?;
    pty.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    pty.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    let guard = state.session.lock().unwrap();
    let pty = guard.as_ref().ok_or("pty not started")?;
    pty.master
        .resize(size(cols, rows))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_nothing_out_of_plain_text() {
        assert_eq!(safe_cut(b"hello world\n"), 12);
    }

    #[test]
    fn keeps_a_complete_sequence() {
        let buf = b"\x1b[31mred\x1b[0m";
        assert_eq!(safe_cut(buf), buf.len());
    }

    #[test]
    fn holds_back_a_partial_csi() {
        // The parameters have arrived but the final byte has not.
        assert_eq!(safe_cut(b"text\x1b[38;2;255"), 4);
        // Nothing after the ESC at all.
        assert_eq!(safe_cut(b"text\x1b"), 4);
        assert_eq!(safe_cut(b"text\x1b["), 4);
    }

    #[test]
    fn holds_back_a_partial_osc_and_releases_it_on_either_terminator() {
        assert_eq!(safe_cut(b"text\x1b]133;D;0"), 4);
        let bel = b"text\x1b]133;D;0\x07";
        assert_eq!(safe_cut(bel), bel.len());
        let st = b"text\x1b]133;D;0\x1b\\";
        assert_eq!(safe_cut(st), st.len());
    }

    #[test]
    fn a_two_byte_escape_is_whole() {
        let buf = b"text\x1b7";
        assert_eq!(safe_cut(buf), buf.len());
    }

    #[test]
    fn gives_up_rather_than_stalling_on_an_overlong_sequence() {
        // An ESC further back than MAX_HOLD is not found, and the buffer is sent
        // rather than held forever waiting for a terminator.
        let mut buf = b"\x1b]52;c;".to_vec();
        buf.extend(std::iter::repeat(b'A').take(MAX_HOLD + 16));
        assert_eq!(safe_cut(&buf), buf.len());
    }

    #[test]
    fn an_escape_inside_output_does_not_hold_back_what_follows_it() {
        // The cut point is the *trailing* partial sequence, not the first ESC.
        let buf = b"\x1b[31mred\x1b[0m and plain text after it";
        assert_eq!(safe_cut(buf), buf.len());
    }
}
