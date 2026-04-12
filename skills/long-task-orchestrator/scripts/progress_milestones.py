#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from typing import Iterable


def parse_reported(values: str) -> list[float]:
    if not values.strip():
        return []
    output = []
    for item in values.split(","):
        text = item.strip()
        if not text:
            continue
        value = float(text)
        if not 0.0 <= value <= 1.0:
            raise ValueError("reported fractions must be between 0 and 1")
        output.append(value)
    return sorted(set(output))


def select_mode(estimated_seconds: int, mode: str) -> str:
    if mode != "auto":
        return mode
    if estimated_seconds < 45 * 60:
        return "events"
    if estimated_seconds < 3 * 60 * 60:
        return "thirds"
    return "quarters"


def checkpoints_for_mode(mode: str) -> list[float]:
    if mode == "events":
        return []
    if mode == "thirds":
        return [1.0 / 3.0, 2.0 / 3.0]
    if mode == "quarters":
        return [0.25, 0.5, 0.75]
    raise ValueError(f"unsupported mode: {mode}")


def next_checkpoint(checkpoints: Iterable[float], progress: float, reported: list[float]) -> float | None:
    for checkpoint in checkpoints:
        if checkpoint <= progress and checkpoint not in reported:
            return checkpoint
        if checkpoint > progress:
            return checkpoint
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Plan event, third, or quarter milestone reports for a long-running task.",
    )
    parser.add_argument("--estimated-seconds", type=int, required=True, help="Estimated total task duration.")
    parser.add_argument(
        "--mode",
        choices=("auto", "events", "thirds", "quarters"),
        default="auto",
        help="Milestone selection mode.",
    )
    parser.add_argument(
        "--progress",
        type=float,
        default=0.0,
        help="Current progress fraction from 0.0 to 1.0.",
    )
    parser.add_argument(
        "--reported",
        default="",
        help="Comma-separated checkpoint fractions already reported, for example 0.25,0.5",
    )
    args = parser.parse_args()

    if args.estimated_seconds <= 0:
        raise SystemExit("--estimated-seconds must be positive")
    if not 0.0 <= args.progress <= 1.0:
        raise SystemExit("--progress must be between 0.0 and 1.0")

    reported = parse_reported(args.reported)
    mode = select_mode(args.estimated_seconds, args.mode)
    checkpoints = checkpoints_for_mode(mode)
    due_now = [value for value in checkpoints if value <= args.progress and value not in reported]
    payload = {
        "estimated_seconds": args.estimated_seconds,
        "mode": mode,
        "progress": args.progress,
        "checkpoints": checkpoints,
        "reported": reported,
        "due_now": due_now,
        "next_checkpoint": next_checkpoint(checkpoints, args.progress, reported),
        "terminal_notification_expected": True,
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
