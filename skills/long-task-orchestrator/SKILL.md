---
name: long-task-orchestrator
description: Run long or high-latency work in the background with an early ETA, milestone-based progress updates, completion or failure notifications, and resumable runtime state. Use when a task is likely to run longer than about 10 minutes, involves training, evaluation, builds, downloads, scraping, or batch processing, or needs progress reports without blocking the chat.
---

# Long Task Orchestrator

## Overview

Use this skill when work should continue in the background while the user keeps receiving concise progress updates. The canonical long-task protocol lives in [references/formal-spec.md](references/formal-spec.md). The goal is to standardize four behaviors:

- start with a rough ETA instead of waiting silently
- move long-running work into a background process when possible
- report progress by milestones, not arbitrary fixed hours
- preserve enough runtime state that interruption does not erase completed work

If the current repo already has status files, notifier scripts, handoff logic, or log conventions, extend those instead of inventing a parallel stack.

## Trigger Rules

Default to this skill when any of the following is true:

- the task is likely to run for more than 10 minutes
- the task duration is uncertain but could plausibly exceed 10 minutes
- the task is a training run, evaluation pass, bulk download, long build, scrape, migration, or batch transform
- the user explicitly wants background execution, progress updates, ETA, completion reminders, or resumability
- the task depends on GPU, network, or remote resources and the user should not have to stare at the screen

Do not force background mode when:

- the task is short and interactive
- the user explicitly wants foreground execution
- the environment prevents safe background execution and no durable monitoring path exists

## Workflow

### 1. Decide Long-Task Mode

Before launching anything substantial:

- estimate whether the task will exceed about 10 minutes
- identify the measurable unit of progress: samples, batches, files, epochs, records, steps, checkpoints, or stages
- check whether the project already has a status file or progress output you can reuse

If long-task mode applies, tell the user you are switching to background execution and that you will report ETA and milestones.

### 2. Prepare Runtime State

Create or reuse a task-local runtime directory before launch. Prefer an existing project runtime area. Otherwise create a dedicated directory such as:

- `<repo>/.codex-long-tasks/<task-slug>/`
- `<repo>/run_logs/<task-slug>/`

At minimum, plan for these artifacts:

- `status.json` for machine-readable current state
- `stdout.log` or merged log file
- one resumable snapshot file if partial results matter
- append-only result files such as `rows.jsonl` or partial outputs when the task produces many units

Read [references/runtime-state.md](references/runtime-state.md) for the status schema summary, and use [references/formal-spec.md](references/formal-spec.md) as the source of truth for file roles and persistence requirements.

### 3. Estimate ETA Before Launch

Always provide a startup ETA, even if it is rough. Use the best available source:

- prior runs in logs
- known input size times historical throughput
- documented runtime expectations
- a pilot subset or warm-up batch
- a conservative range when precise throughput is unknown

Label the estimate mentally as one of:

- `preflight`: rough estimate before real throughput is observed
- `measured`: updated from stable progress after the task starts

The first user update should include:

- what is running
- whether it is in the background
- rough total ETA
- what progress unit will be tracked
- when the next report should arrive

### 4. Choose Reporting Cadence

Use milestone-based progress, not a fixed 1.5 hour timer.

Default policy:

- estimated under 45 minutes: send acceptance, key event, and terminal updates only
- estimated 45 minutes to under 3 hours: report at roughly `1/3` and `2/3`, plus the terminal update
- estimated 3 hours or more: report at roughly `1/4`, `1/2`, `3/4`, plus the terminal update

Also send an extra update when:

- the first usable ETA becomes available after warm-up
- the task changes stage in a meaningful way
- ETA drifts by more than about 25 percent
- the task stalls or heartbeat updates stop appearing
- the task fails, is cancelled, or is interrupted

Use `scripts/progress_milestones.py` when you want a deterministic checkpoint plan from the current ETA and progress fraction.

Read [references/reporting-policy.md](references/reporting-policy.md) for the condensed cadence rules, and read [references/formal-spec.md](references/formal-spec.md) when you need the full trigger and re-estimation protocol.

### 5. Launch in the Background

Prefer a background pattern that survives the current shell session and leaves a PID or equivalent handle plus a durable log file.

- On Windows, prefer `Start-Process` over fragile session-bound jobs when the process must outlive the current shell.
- On Linux, prefer `nohup`, `setsid`, or an existing `tmux` or `screen` pattern already used by the project.
- Capture enough metadata to monitor the task later: PID, command, log path, status path, output path.

Read [references/platform-launch-patterns.md](references/platform-launch-patterns.md) for practical Windows and Linux launch patterns.

### 6. Keep State Resumable

Never rely only on in-memory results for long jobs.

For long evaluations or batch tasks:

- update `status.json` on each meaningful chunk or batch
- refresh a snapshot file regularly
- append successful units incrementally
- append failures incrementally
- flush stage-complete outputs before moving to the next stage

Prefer the generic component roles from the formal spec:

- `sender`
- `completion_notifier`
- `progress_reporter`
- `status_writer`
- `resumable_result_sink`

If the task is interrupted, the next update to the user should say exactly what was preserved and how much work would need to be resumed.

### 7. Close Out Cleanly

On completion or failure, send a final concise report with:

- final state
- elapsed time
- output locations
- whether ETA was roughly accurate
- resume implications, if any

If a notifier or watcher is needed, make it idempotent so it does not spam duplicate completion messages.

## Message Shape

Keep progress messages compact. The useful default shape is:

- current stage
- progress completed out of total, or percent when total exists
- elapsed time
- latest ETA and remaining time
- log or output path if the user may need it
- next report checkpoint

Avoid verbose logs in chat unless the user asked for them.

## Notes

- Prefer reuse over reinvention. If a repo already has a watcher, status file, or handoff summary, extend that.
- Prefer measured ETA over fixed timers as soon as real throughput stabilizes.
- If total work is unknown, fall back to stage-change and heartbeat reporting instead of pretending the ETA is precise.
- Prefer the formal spec's generic names and thresholds over project-specific labels such as hard-coded polling intervals.
