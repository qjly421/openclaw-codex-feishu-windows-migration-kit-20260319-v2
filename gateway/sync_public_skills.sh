#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_SOURCE="${1:-$REPO_ROOT/skills}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SKILLS_DEST="${2:-$CODEX_HOME/skills}"

if [[ ! -d "$SKILLS_SOURCE" ]]; then
  echo "Skills source directory not found: $SKILLS_SOURCE" >&2
  exit 1
fi

mkdir -p "$SKILLS_DEST"

sync_one_skill() {
  local source_dir="$1"
  local skill_name
  local dest_dir

  skill_name="$(basename "$source_dir")"
  dest_dir="$SKILLS_DEST/$skill_name"

  mkdir -p "$dest_dir"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude '.DS_Store' "$source_dir/" "$dest_dir/"
  else
    rm -rf "$dest_dir"
    mkdir -p "$dest_dir"
    cp -R "$source_dir"/. "$dest_dir"/
  fi

  echo "Synced skill: $skill_name -> $dest_dir"
}

shopt -s nullglob
skill_dirs=("$SKILLS_SOURCE"/*)
if [[ ${#skill_dirs[@]} -eq 0 ]]; then
  echo "No public skills found under $SKILLS_SOURCE" >&2
  exit 1
fi

for skill_dir in "${skill_dirs[@]}"; do
  [[ -d "$skill_dir" ]] || continue
  sync_one_skill "$skill_dir"
done

echo "Public skills are available under: $SKILLS_DEST"
