# Archive Persistence Test Targets

## Scope
- Auto-save: archive workspace before inactivity timeout-based pause.
- Auto-update: upload only when workspace archive hash changed.
- Auto-restore: recover workspace from Cloudflare R2 archive on new sandbox startup.

## Targets
1. `T1` Dirty flag set/clear behavior:
   - file change marks `pendingArchiveUpdate=true`
   - archive completion clears dirty flags
2. `T2` Archive upload behavior:
   - changed workspace uploads `workspace.tar.gz` + snapshot + metadata
   - unchanged workspace skips archive/snapshot upload and keeps `up_to_date`
3. `T3` Restore behavior:
   - picks best key from metadata/archive fallback
   - restores to original workspace path and clears existing files first
4. `T4` Timeout window behavior:
   - before timeout window: no archive/pause
   - within timeout window and dirty: archive + pause
   - within timeout window and clean: pause only
5. `T5` Activity coverage:
   - sandbox interaction routes update `lastActiveAt`
   - heartbeat-only updates must not delay archive timeout trigger
