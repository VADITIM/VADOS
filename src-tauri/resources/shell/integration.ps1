# VAD/OS shell integration — emits OSC 133 command-boundary markers and OSC 7
# cwd reports from the prompt function. PowerShell has no separate preexec
# hook without PSReadLine customization, so this approximates: A and B fire
# together when the prompt renders (there is effectively no gap between
# "prompt shown" and "input begins" from the shell's point of view), and D
# carries the previous command's exit code. OSC 133;C (output start) is
# omitted — treated as optional per spec.
#
# Windows PowerShell 5.1 does not support the `e backtick-escape (PS7+ only),
# so ESC is built explicitly via [char]27.
$global:__vadosEsc = [char]27
# BEL as the OSC terminator, not the two-byte ST (ESC \). ST is legal and it is
# what this file used to send, but it is two bytes with a backslash as the
# second one, and anything that loses or consumes the ESC — a redraw that
# reprints part of the prompt, a parser reset between the two bytes — leaves
# that backslash on screen as literal text. That is where the stray `\` in
# front of a typed character came from, and why it could not be deleted: the
# shell's line editor does not know it is there, because the shell never typed
# it. BEL is one byte, cannot be split, and is accepted for OSC everywhere.
$global:__vadosSt = [char]7

function global:prompt {
    # $? must be read as the very first statement — any other statement here
    # overwrites it. $LASTEXITCODE alone is wrong: it is only set by native
    # executables and keeps its old value across cmdlets, so one failing `git`
    # makes every later prompt report that same exit code forever.
    $ok = $?
    $native = $global:LASTEXITCODE
    if ($ok) {
        $ec = 0
    } elseif ($native) {
        $ec = $native
    } else {
        $ec = 1
    }
    $global:LASTEXITCODE = 0
    $cwd = ($PWD.Path -replace '\\', '/')
    $e = $global:__vadosEsc
    $st = $global:__vadosSt
    # Everything that is not visible prompt text is written to the console
    # directly instead of being returned as part of the prompt string.
    #
    # PSReadLine remembers where the prompt ended so it can redraw the input
    # line in place, and it derives that from the prompt string it was given.
    # Escape sequences in that string are zero-width on screen but not in the
    # string, so its idea of the prompt's geometry came out wrong — and the
    # first thing that forces a full-line redraw then rewrote the line at the
    # wrong column. Typing an opening bracket is exactly such a trigger
    # (PSReadLine re-renders to match and colorize brackets), which is why
    # `(`, `{` and `[` landed *inside* the prompt, overwriting the `> ` and
    # taking the prompt marker VAD/OS strips with them: the input mirror then
    # had no prompt to find on the row and showed nothing at all.
    #
    # A direct write lands at the same point in the stream — the prompt
    # function runs before the prompt is printed — and PSReadLine never sees
    # it. Only `133;B` has to stay in the returned string, because it marks
    # the point *after* the prompt text where input begins.
    [Console]::Write("$e]133;D;$ec$st$e]133;A$st$e]7;file://$env:COMPUTERNAME/$cwd$st")
    return "PS $($PWD.Path)> $e]133;B$st"
}
