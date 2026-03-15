# OneCEO Service Manager GUI

macOS GUI tool for starting, stopping, restarting, and inspecting the local OneCEO dev services.

## Features

- Manage `Web`, `API`, `Admin Web`, and `Admin API` separately
- Start, stop, and restart each service
- Start, stop, and restart all services
- Show service status and local URL
- Force-kill any process listening on a port
- Run status polling and service actions asynchronously so one slow service does not freeze the whole GUI
- Show per-service retry policy hints for timeout/failure handling
- Include a bottom log panel that tails the selected service log file
- Prioritize button actions over background polling; service actions can force-release the target port when needed
- Split refresh work and user-triggered actions into separate thread pools so auto-refresh does not block button operations
- Probe service status in parallel and discard stale refresh payloads before they overwrite newer UI state
- Treat start/stop/restart/kill-port buttons as non-blocking command dispatch; the UI no longer waits with disabled controls
- Disable automatic log polling by default and rely on manual refresh plus post-action refresh to reduce UI contention

## Run From Source

```bash
python3 tools/service_manager_gui/service_manager_gui.py
```

## Build

```bash
bash tools/service_manager_gui/build-mac.sh
```

Build output:

- `tools/service_manager_gui/dist/OneCEO Service Manager.app`

## Notes

- The app resolves the repo root automatically and prefers the current repo.
- Service state files reuse `/tmp/oneceo-mac` and `/tmp/oneceo-mac-admin`.
- The packaged app assumes this repo still exists on the same machine.
