# Platform Launch Patterns

Use this reference when you need a durable background process pattern for long tasks.

## Windows PowerShell

Prefer `Start-Process` when the task must survive the current shell.

Typical pattern:

- create a log path first
- launch `powershell.exe` or the target executable with redirected output
- capture the returned process object or PID
- write the PID and paths into `status.json`

Guidance:

- prefer `Start-Process -PassThru` over session-bound jobs for long independent runs
- avoid backgrounding commands without a log file
- if the project already has a runner script, background that script instead of embedding a huge inline command

## Linux Shell

Prefer one of these:

- `nohup bash -lc '<command>' > stdout.log 2>&1 &`
- `setsid bash -lc '<command>' > stdout.log 2>&1 < /dev/null &`
- an existing `tmux` or `screen` session if the repo already uses it

Guidance:

- capture the PID right away
- write the PID, log path, and status path into runtime state
- use a wrapper script when the command is complex

## Monitoring

After launch, verify quickly that:

- the process exists
- the log file is being written
- `status.json` is created or updated
- the first ETA message has enough information to be useful

If any of those checks fail, do not claim the long task is safely detached yet.
