# Reporting Policy

Use this reference when deciding when to update the user and what each update should contain. For the full protocol, including re-estimation and file-role rules, read [formal-spec.md](formal-spec.md).

## Startup Update

Send an immediate kickoff update after the task is launched or committed to launch.

Include:

- task name
- background or foreground mode
- rough total ETA, or that ETA will be filled in after warm-up
- progress unit
- next report checkpoint or next expected event update

## Milestone Schedule

Default milestone schedule:

- estimated under 45 minutes: no fixed milestones
  - send acceptance, key event, and terminal updates
- estimated 45 minutes to under 3 hours: thirds
  - roughly 33 percent
  - roughly 67 percent
  - terminal update separately
- estimated 3 hours or more: quarters
  - roughly 25 percent
  - 50 percent
  - 75 percent
  - terminal update separately

Use measured throughput to revise ETA once progress is stable.

## Extra Updates

Send an out-of-band update when:

- the first usable ETA becomes available after warm-up
- ETA drifts by more than about 25 percent
- the absolute remaining time shifts by roughly 20 minutes or more
- the stage name changes materially
- the first useful intermediate result appears
- the task stalls, stops heartbeating, or looks unhealthy
- a retry or fallback path starts
- a parallel worker fails, restarts, or materially slows the aggregate job
- the task finishes, fails, or is cancelled

## Unknown Totals

If total work is unknown, do not fake percent complete.

Instead report:

- current stage
- elapsed time
- observed throughput if meaningful
- current ETA range or `unknown`
- next heartbeat or stage-change expectation

In unknown-total mode, use stage-change updates plus coarse heartbeat updates rather than thirds or quarters.

## Message Template

Prefer short chat updates in this shape:

- `<task>: stage <stage>`
- `progress: <processed>/<total> <unit> (<percent>)`
- `elapsed: <elapsed>`
- `ETA: <remaining> remaining, total about <total_estimate>`
- `next update: around <next checkpoint>`

For short ETA tasks without fixed milestones:

- `<task>: accepted and running in background`
- `ETA: <estimate or warm-up pending>`
- `next update: key event or completion`

If there is no total:

- `<task>: stage <stage>`
- `elapsed: <elapsed>`
- `throughput: <rate>`
- `ETA: <range or unknown>`
- `next update: next stage change or heartbeat`
