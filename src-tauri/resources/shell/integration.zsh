# VAD/OS shell integration — emits OSC 133 command-boundary markers and OSC 7
# cwd reports. Loaded as $ZDOTDIR/.zshrc so this must explicitly source the
# user's real .zshrc first (ZDOTDIR override hides it otherwise).

if [ -f ~/.zshrc ]; then
  ZDOTDIR=~ source ~/.zshrc
fi

__vados_osc7() {
  printf '\033]7;file://%s%s\033\\' "$HOST" "$PWD"
}

# precmd runs right before the prompt is drawn — previous command's exit code
# is still live, so capture it first.
__vados_precmd() {
  local ec=$?
  printf '\033]133;D;%s\033\\\033]133;A\033\\' "$ec"
  __vados_osc7
}

# preexec runs once the user has submitted a command, right before it executes.
__vados_preexec() {
  printf '\033]133;C\033\\'
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd __vados_precmd
add-zsh-hook preexec __vados_preexec

# Marks the end of the prompt / start of typed input.
PS1="${PS1}"'%{$(printf "\033]133;B\033\\\\")%}'
