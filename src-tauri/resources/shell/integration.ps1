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
$global:__vadosSt = $global:__vadosEsc + "\"

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
    $out = "$e]133;D;$ec$st$e]133;A$st"
    $out += "$e]7;file://$env:COMPUTERNAME/$cwd$st"
    $out += "PS $($PWD.Path)> "
    $out += "$e]133;B$st"
    return $out
}
