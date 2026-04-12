# Runtime State

Use this reference when you need a concise status model or resumability rules for a long background task. The full lifecycle rules live in [formal-spec.md](formal-spec.md).

## Minimum File Set

Each long task should maintain at least these files:

- `status.json`
- `snapshot.json`
- `rows.jsonl`
- `failed_rows.jsonl`
- `result.json` or an equivalent structured final output
- `result.md` or an equivalent readable summary
- `notify.sent` or another sentinel file for idempotent terminal notification

## Canonical Status Fields

Prefer the canonical `status.json` shape below:

- `task_id`
- `task_name`
- `status`
  - `pending`, `running`, `finished`, `failed`, `cancelled`
- `stage`
- `started_at`
- `updated_at`
- `background`
- `estimated_total_seconds`
- `remaining_seconds`
- `processed_units`
- `total_units`
- `progress_ratio`
- `current_metrics`
- `output_paths`
- `last_error`
- `next_report_checkpoint`

Useful optional fields:

- `pid`
- `host`
- `throughput_per_minute`
- `snapshot_path`
- `rows_jsonl_path`
- `failed_rows_jsonl_path`
- `subtasks`
- `aggregate_progress`
- `resume_supported`

## Compatibility Aliases

When integrating older project-specific implementations, these aliases are acceptable during migration:

- `state` as an alias for `status`
- `completed_units` as an alias for `processed_units`
- `progress_fraction` as an alias for `progress_ratio`
- `estimated_remaining_seconds` as an alias for `remaining_seconds`
- domain-specific names such as `processed_samples` only when clearly mapped to `processed_units`

Prefer the canonical names in new code and new skills.

## Example Shape

```json
{
  "task_id": "wind-baseline-eval",
  "task_name": "Wind baseline evaluation",
  "status": "running",
  "background": true,
  "started_at": "2026-03-27T12:00:00Z",
  "updated_at": "2026-03-27T12:18:11Z",
  "stage": "epoch1/batch420",
  "processed_units": 420,
  "total_units": 1200,
  "progress_ratio": 0.35,
  "estimated_total_seconds": 7200,
  "remaining_seconds": 4680,
  "current_metrics": {
    "mae": 0.123
  },
  "output_paths": [
    "/path/to/final.json",
    "/path/to/final.md"
  ],
  "next_report_checkpoint": 0.5,
  "snapshot_path": "/path/to/snapshot.json",
  "rows_jsonl_path": "/path/to/rows.jsonl",
  "failed_rows_jsonl_path": "/path/to/failed_rows.jsonl",
  "resume_supported": true
}
```

## Persistence Rules

For long tasks, preserve progress at chunk boundaries rather than only at the end.

- Update `status.json` whenever progress meaningfully changes.
- Refresh `updated_at` frequently enough that a stalled watcher can notice.
- Refresh `snapshot.json` at batch, window, or phase cadence.
- Append completed items incrementally to `rows.jsonl`.
- Append failed items incrementally to `failed_rows.jsonl`.
- Write stage-complete structured results before advancing to the next stage.

## Recovery Rules

When interruption is possible:

- keep enough metadata to skip already-completed units
- store checkpoints or snapshots in deterministic paths
- avoid rewriting finished data unless the task is explicitly restarted from scratch
- make completion watchers check both state and durable outputs before alerting
- prefer inheriting the prior result directory over restarting from zero

## Practical Rule

If you would be upset to lose the last 10 to 20 minutes of work, that work should already be on disk.
