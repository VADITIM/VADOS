# VAD/OS shell integration — emits OSC 133 command-boundary markers and OSC 7
# cwd reports. Loaded via `bash --rcfile` so the user's own .bashrc is sourced
# first, then this appends its hooks.

[ -f ~/.bashrc ] && source ~/.bashrc

__vados_osc7() {
  printf '\033]7;file://%s%s\033\\' "$HOSTNAME" "$PWD"
}

# PROMPT_COMMAND runs after every command, before the next prompt is drawn.
# $? must be captured as the very first statement or it is lost.
__vados_prompt_command() {
  local ec=$?
  printf '\033]133;D;%s\033\\\033]133;A\033\\' "$ec"
  __vados_osc7
}

if [[ "$PROMPT_COMMAND" != *__vados_prompt_command* ]]; then
  PROMPT_COMMAND="__vados_prompt_command${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi

# Marks the end of the prompt / start of typed input. Appended invisibly via
# \[ \] so bash's line-length calculation ignores it.
PS1="${PS1}"'\[$(printf "\033]133;B\033\\\\")\]'
