# Altus Eval Scripts

This directory contains the first executable scaffold for the Altus ability evaluation suite.

## Commands

Initialize a run directory from the adopted seed:

```bash
pnpm --filter api altus-eval:init -- --smoke
```

Initialize a full run with explicit metadata:

```bash
pnpm --filter api altus-eval:init -- \
  --suite ../../../docs/智能体能力测试题库/题库种子/altus_eval_seed_v1.json \
  --executor manual \
  --provider anthropic \
  --model claude-sonnet \
  --temperature 0.2 \
  --base-url http://localhost:4000 \
  --mode managed \
  --auth-profile playwright-test-account
```

Finalize a run after filling `case_results.jsonl`:

```bash
pnpm --filter api altus-eval:finalize -- --run-dir ../../../docs/智能体能力测试题库/结果归档/20260420/altus-general-v1/run_20260420_150000
```

## Output

Each initialized run creates:

1. `run_manifest.json`
2. `case_results.jsonl`
3. `summary.md`
4. `artifacts/`

`init-run.ts` seeds `case_results.jsonl` with `not_run` placeholders.
`finalize-run.ts` recalculates totals and rewrites the summary.
