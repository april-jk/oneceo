#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/oneceo_test?sslmode=disable}"

printf '\n[archive-tests] root: %s\n' "$ROOT_DIR"
printf '[archive-tests] step 1/3: verify test target document\n'
if [[ ! -f "$ROOT_DIR/tests/archive-persistence-test-targets.md" ]]; then
  echo "[archive-tests] missing tests/archive-persistence-test-targets.md" >&2
  exit 1
fi

printf '[archive-tests] step 2/3: run archive-flow unit tests\n'
pnpm --dir "$ROOT_DIR" exec tsx --test \
  "$ROOT_DIR/tests/sandbox-activity.service.test.ts" \
  "$ROOT_DIR/tests/sandbox-archive.service.test.ts" \
  "$ROOT_DIR/tests/sandbox-archive-job.service.test.ts"

printf '[archive-tests] step 3/3: validate test target coverage\n'
for target in \
  "tests/sandbox-activity.service.test.ts" \
  "tests/sandbox-archive.service.test.ts" \
  "tests/sandbox-archive-job.service.test.ts"; do
  if [[ ! -f "$ROOT_DIR/$target" ]]; then
    echo "[archive-tests] missing required test file: $target" >&2
    exit 1
  fi
done

printf '\n[archive-tests] all checks passed\n'
