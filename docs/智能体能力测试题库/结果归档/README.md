# 结果归档

本目录用于存放每次实际执行后的评测结果。

建议路径：

```text
结果归档/YYYYMMDD/<suite_id>/<run_id>/
```

每次 run 至少保留：

1. `run_manifest.json`
2. `case_results.jsonl`
3. `summary.md`
4. `artifacts/`

注意：

- 不要只保留摘要，不保留单题结果。
- 不要把不同 `suite_version` 的结果混在同一个 run 目录。
- 命中硬失败的 case 必须保留直接证据。
