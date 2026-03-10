#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Callable

import tkinter as tk
from tkinter import scrolledtext
from tkinter import messagebox, ttk


BUILD_REPO_ROOT = Path("/Users/eunice/codingProject/oneceo")
STATE_DIR_MAIN = Path("/tmp/oneceo-mac")
STATE_DIR_ADMIN = Path("/tmp/oneceo-mac-admin")
COMMAND_TIMEOUT_SECONDS = 2.5
SHELL_PATH_TIMEOUT_SECONDS = 8.0
START_READY_TIMEOUT_SECONDS = 35.0
START_RETRY_LIMIT = 2
STOP_GRACE_SECONDS = 3.0
LOG_TAIL_CHARS = 8000
LOG_REFRESH_INTERVAL_MS = 1200


@dataclass(frozen=True)
class ServiceSpec:
    key: str
    label: str
    port: int
    url: str
    health_url: str
    cwd: Path
    command: tuple[str, ...]
    pid_file: Path
    log_file: Path


@dataclass
class ServiceStatus:
    state: str
    text: str
    detail: str
    pid_text: str


def is_repo_root(path: Path) -> bool:
    required = (
        path / "apps" / "web" / "package.json",
        path / "apps" / "api" / "package.json",
        path / "apps" / "admin_management" / "package.json",
    )
    return all(item.exists() for item in required)


def candidate_paths() -> list[Path]:
    candidates: list[Path] = []

    env_root = os.environ.get("ONECEO_ROOT")
    if env_root:
        candidates.append(Path(env_root).expanduser())

    candidates.append(BUILD_REPO_ROOT)
    candidates.append(Path.cwd())

    if getattr(sys, "frozen", False):
        current = Path(sys.executable).resolve()
    else:
        current = Path(__file__).resolve()

    candidates.extend(current.parents)
    return candidates


def resolve_repo_root() -> Path:
    seen: set[Path] = set()
    for candidate in candidate_paths():
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if is_repo_root(resolved):
            return resolved
    raise FileNotFoundError("Unable to locate the oneceo repo root.")


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")

    return values


class ServiceController:
    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.admin_root = repo_root / "apps" / "admin_management"
        self.app_env = read_env_file(repo_root / "apps" / ".env")
        self.runtime_env = self._build_runtime_env()
        self.command_cache: dict[str, str] = {}
        self.pnpm_prefix = self._resolve_pnpm_prefix()
        self.services = self._build_services()
        self.service_map = {service.key: service for service in self.services}

    def _build_runtime_env(self) -> dict[str, str]:
        env = os.environ.copy()
        shell_path = self._read_shell_path()
        if shell_path:
            current = env.get("PATH", "")
            env["PATH"] = shell_path if not current else f"{shell_path}:{current}"
        env["ONECEO_ROOT"] = str(self.repo_root)
        return env

    def _read_shell_path(self) -> str:
        shell = os.environ.get("SHELL") or "/bin/zsh"
        try:
            result = subprocess.run(
                [shell, "-lc", 'printf "%s" "$PATH"'],
                check=True,
                capture_output=True,
                text=True,
                timeout=SHELL_PATH_TIMEOUT_SECONDS,
            )
        except Exception:
            return ""

        return result.stdout.strip()

    def _resolve_pnpm_prefix(self) -> tuple[str, ...]:
        pnpm = self._which("pnpm")
        if pnpm:
            return (pnpm,)

        corepack = self._which("corepack")
        if corepack:
            return (corepack, "pnpm")

        raise RuntimeError("Missing pnpm/corepack. Please install Node.js tooling first.")

    def _build_services(self) -> list[ServiceSpec]:
        api_port = int(self.app_env.get("PORT", "4000") or "4000")
        web_port = 3000
        admin_api_port = int(self.app_env.get("ADMIN_MANAGEMENT_PORT", "9310") or "9310")
        admin_web_port = int(
            self.app_env.get("ADMIN_MANAGEMENT_WEB_PORT", self.app_env.get("VITE_DEV_PORT", "5174")) or "5174"
        )

        return [
            ServiceSpec(
                key="api",
                label="后端 API",
                port=api_port,
                url=f"http://localhost:{api_port}",
                health_url=f"http://127.0.0.1:{api_port}/health",
                cwd=self.repo_root,
                command=(*self.pnpm_prefix, "--filter", "api", "dev"),
                pid_file=STATE_DIR_MAIN / "api.pid",
                log_file=STATE_DIR_MAIN / "api.log",
            ),
            ServiceSpec(
                key="web",
                label="前端 Web",
                port=web_port,
                url=f"http://localhost:{web_port}",
                health_url=f"http://127.0.0.1:{web_port}",
                cwd=self.repo_root,
                command=(*self.pnpm_prefix, "--filter", "web", "dev"),
                pid_file=STATE_DIR_MAIN / "web.pid",
                log_file=STATE_DIR_MAIN / "web.log",
            ),
            ServiceSpec(
                key="admin-api",
                label="管理后端 API",
                port=admin_api_port,
                url=f"http://localhost:{admin_api_port}",
                health_url=f"http://127.0.0.1:{admin_api_port}/health",
                cwd=self.admin_root,
                command=(self._require_cmd("npm"), "run", "dev:api"),
                pid_file=STATE_DIR_ADMIN / "admin-api.pid",
                log_file=STATE_DIR_ADMIN / "admin-api.log",
            ),
            ServiceSpec(
                key="admin-web",
                label="管理前端 Web",
                port=admin_web_port,
                url=f"http://localhost:{admin_web_port}",
                health_url=f"http://127.0.0.1:{admin_web_port}",
                cwd=self.admin_root,
                command=(self._require_cmd("npm"), "run", "dev:web"),
                pid_file=STATE_DIR_ADMIN / "admin-web.pid",
                log_file=STATE_DIR_ADMIN / "admin-web.log",
            ),
        ]

    def _which(self, command: str) -> str | None:
        if command in self.command_cache:
            return self.command_cache[command]

        found = shutil.which(command, path=self.runtime_env.get("PATH"))
        if found:
            self.command_cache[command] = found
        return found

    def _require_cmd(self, command: str) -> str:
        found = self._which(command)
        if found:
            return found
        raise RuntimeError(f"Missing required command: {command}")

    def _read_pid(self, path: Path) -> int | None:
        if not path.exists():
            return None
        try:
            raw = path.read_text(encoding="utf-8").strip()
            return int(raw) if raw else None
        except Exception:
            return None

    def _write_pid(self, path: Path, pid: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(pid), encoding="utf-8")

    def _clear_pid(self, path: Path) -> None:
        try:
            path.unlink()
        except FileNotFoundError:
            pass

    def _pid_alive(self, pid: int | None) -> bool:
        if pid is None:
            return False
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    def _run_output(self, command: list[str], timeout: float = COMMAND_TIMEOUT_SECONDS) -> str:
        try:
            result = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                env=self.runtime_env,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return ""
        return (result.stdout or "").strip()

    def _listening_pids(self, port: int) -> list[int]:
        lsof = self._which("lsof")
        if not lsof:
            return []
        output = self._run_output([lsof, "-t", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"])
        pids: list[int] = []
        for line in output.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                pids.append(int(line))
            except ValueError:
                continue
        return pids

    def _command_for_pid(self, pid: int) -> str:
        ps = self._which("ps")
        if not ps:
            return ""
        return self._run_output([ps, "-p", str(pid), "-o", "command="])

    def _cwd_for_pid(self, pid: int) -> str:
        lsof = self._which("lsof")
        if not lsof:
            return ""
        output = self._run_output([lsof, "-a", "-d", "cwd", "-p", str(pid), "-Fn"])
        for line in output.splitlines():
            if line.startswith("n"):
                return line[1:]
        return ""

    def _matches_repo_process(self, pid: int, service: ServiceSpec) -> bool:
        cmd = self._command_for_pid(pid)
        cwd = self._cwd_for_pid(pid)
        if str(self.repo_root) in cmd or str(service.cwd) in cmd:
            return True
        if cwd.startswith(str(self.repo_root)) or cwd.startswith(str(service.cwd)):
            return True
        return False

    def _port_open(self, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.4)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    def _url_ok(self, url: str) -> bool:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as response:
                return 200 <= response.status < 500
        except Exception:
            return False

    def _wait_for_ready(self, service: ServiceSpec, timeout: float = 45.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._port_open(service.port) and self._url_ok(service.health_url):
                return
            pid = self._read_pid(service.pid_file)
            if pid is not None and not self._pid_alive(pid):
                break
            time.sleep(1)

        tail = self._read_log_tail(service.log_file)
        raise RuntimeError(f"{service.label} 启动失败。\n\n日志尾部：\n{tail}")

    def _read_log_tail(self, path: Path, max_chars: int = 1600) -> str:
        if not path.exists():
            return "日志文件不存在。"
        content = path.read_text(encoding="utf-8", errors="replace")
        return content[-max_chars:].strip() or "日志为空。"

    def _kill_pid(self, pid: int, force: bool = False) -> None:
        sig = signal.SIGKILL if force else signal.SIGTERM
        try:
            pgid = os.getpgid(pid)
            if pgid == pid:
                os.killpg(pgid, sig)
                return
        except Exception:
            pass

        try:
            os.kill(pid, sig)
        except OSError:
            pass

    def _stop_pid(self, pid: int, label: str) -> None:
        if not self._pid_alive(pid):
            return

        self._kill_pid(pid, force=False)
        for _ in range(int(STOP_GRACE_SECONDS * 10)):
            if not self._pid_alive(pid):
                return
            time.sleep(0.1)

        self._kill_pid(pid, force=True)
        for _ in range(3):
            if not self._pid_alive(pid):
                return
            time.sleep(0.3)

        raise RuntimeError(f"{label} 停止失败，PID {pid} 仍然存活。")

    def status(self, service_key: str) -> ServiceStatus:
        service = self.service_map[service_key]
        tracked_pid = self._read_pid(service.pid_file)
        port_pids = self._listening_pids(service.port)
        repo_pids = [pid for pid in port_pids if self._matches_repo_process(pid, service)]

        if port_pids:
            if repo_pids or (tracked_pid in port_pids if tracked_pid else False):
                pid_text = ",".join(str(pid) for pid in repo_pids or port_pids)
                return ServiceStatus("running", "运行中", f"监听端口 {service.port}", pid_text)
            pid_text = ",".join(str(pid) for pid in port_pids)
            return ServiceStatus("occupied", "端口占用", "监听进程不属于当前仓库", pid_text)

        if tracked_pid and self._pid_alive(tracked_pid):
            return ServiceStatus("starting", "启动中", "进程已启动，等待端口就绪", str(tracked_pid))

        return ServiceStatus("stopped", "已停止", f"端口 {service.port} 未监听", "-")

    def all_statuses(self) -> dict[str, ServiceStatus]:
        snapshot: dict[str, ServiceStatus] = {}
        for service in self.services:
            try:
                snapshot[service.key] = self.status(service.key)
            except Exception as exc:
                snapshot[service.key] = ServiceStatus("error", "检测失败", str(exc), "-")
        return snapshot

    def log_tail(self, service_key: str, max_chars: int = LOG_TAIL_CHARS) -> str:
        service = self.service_map[service_key]
        return self._read_log_tail(service.log_file, max_chars=max_chars)

    def _force_release_port(self, port: int, label: str) -> list[int]:
        pids = self._listening_pids(port)
        errors: list[str] = []
        for pid in pids:
            try:
                self._stop_pid(pid, label)
            except RuntimeError as exc:
                errors.append(str(exc))

        if self._port_open(port):
            raise RuntimeError("\n".join(errors) if errors else f"{label} 端口 {port} 仍然被占用。")

        return pids

    def _ensure_dependencies(self, service: ServiceSpec) -> None:
        if service.key in {"api", "web"} and not (self.repo_root / "node_modules").exists():
            raise RuntimeError("仓库根目录缺少 node_modules，请先执行 pnpm install。")
        if service.key.startswith("admin") and not (self.admin_root / "node_modules").exists():
            raise RuntimeError("apps/admin_management 缺少 node_modules，请先执行 npm install。")

    def _spawn_service_process(self, service: ServiceSpec) -> int:
        with service.log_file.open("ab") as log_handle:
            process = subprocess.Popen(
                list(service.command),
                cwd=service.cwd,
                env=self.runtime_env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )

        self._write_pid(service.pid_file, process.pid)
        return process.pid

    def start(self, service_key: str) -> str:
        service = self.service_map[service_key]
        service.pid_file.parent.mkdir(parents=True, exist_ok=True)
        service.log_file.parent.mkdir(parents=True, exist_ok=True)

        current = self.status(service_key)
        if current.state == "running":
            return f"{service.label} 已在运行。"
        self._ensure_dependencies(service)

        if current.state == "occupied" or self._port_open(service.port):
            self._force_release_port(service.port, service.label)
        self._clear_pid(service.pid_file)

        last_error: str | None = None
        for attempt in range(1, START_RETRY_LIMIT + 2):
            if attempt > 1:
                self._clear_pid(service.pid_file)
                if self._port_open(service.port):
                    self._force_release_port(service.port, service.label)

            self._spawn_service_process(service)
            try:
                self._wait_for_ready(service, timeout=START_READY_TIMEOUT_SECONDS)
                if attempt == 1:
                    return f"{service.label} 已启动：{service.url}"
                return f"{service.label} 已启动：{service.url}（第 {attempt} 次尝试成功）"
            except Exception as exc:
                last_error = str(exc)
                try:
                    self._force_release_port(service.port, service.label)
                except Exception:
                    pass
                self._clear_pid(service.pid_file)
                if attempt <= START_RETRY_LIMIT:
                    continue
                break

        raise RuntimeError(
            f"{service.label} 启动失败，已自动重试 {START_RETRY_LIMIT} 次。\n\n最近错误：\n{last_error or '未知错误'}"
        )

    def stop(self, service_key: str) -> str:
        service = self.service_map[service_key]
        tracked_pid = self._read_pid(service.pid_file)
        stopped: set[int] = set()

        if tracked_pid and self._pid_alive(tracked_pid):
            self._stop_pid(tracked_pid, service.label)
            stopped.add(tracked_pid)

        for pid in self._force_release_port(service.port, service.label):
            stopped.add(pid)

        self._clear_pid(service.pid_file)

        if self._port_open(service.port):
            raise RuntimeError(f"{service.label} 端口 {service.port} 仍在监听。")

        if stopped:
            pid_text = ",".join(str(pid) for pid in sorted(stopped))
            return f"{service.label} 已停止，PID: {pid_text}"
        return f"{service.label} 原本未运行。"

    def restart(self, service_key: str) -> str:
        stop_message = self.stop(service_key)
        start_message = self.start(service_key)
        return f"{stop_message}\n{start_message}"

    def kill_port(self, port: int) -> str:
        if port <= 0 or port > 65535:
            raise RuntimeError("端口号必须在 1-65535 之间。")

        pids = self._listening_pids(port)
        if not pids:
            return f"端口 {port} 没有监听进程。"

        errors: list[str] = []
        for pid in pids:
            try:
                self._stop_pid(pid, f"端口 {port}")
            except RuntimeError as exc:
                errors.append(str(exc))

        for service in self.services:
            if service.port == port:
                self._clear_pid(service.pid_file)

        if self._port_open(port):
            raise RuntimeError("\n".join(errors) if errors else f"端口 {port} 仍然被占用。")

        killed = ",".join(str(pid) for pid in pids)
        return f"端口 {port} 已强行释放，PID: {killed}"

    def all_services(self, action: str) -> list[str]:
        if action == "start":
            order = ("api", "web", "admin-api", "admin-web")
        elif action == "stop":
            order = ("admin-web", "admin-api", "web", "api")
        elif action == "restart":
            order = ("api", "web", "admin-api", "admin-web")
        else:
            raise RuntimeError(f"Unsupported action: {action}")

        messages: list[str] = []
        for service_key in order:
            operation = getattr(self, action)
            try:
                messages.append(operation(service_key))
            except Exception as exc:
                messages.append(f"{self.service_map[service_key].label} 失败：{exc}")
        return messages


class ServiceManagerApp:
    def __init__(self, root: tk.Tk, controller: ServiceController):
        self.root = root
        self.controller = controller
        self.queue: Queue[tuple[str, Any]] = Queue()
        self.status_vars: dict[str, dict[str, tk.StringVar]] = {}
        self.state_labels: dict[str, ttk.Label] = {}
        self.service_action_buttons: dict[str, list[ttk.Button]] = {}
        self.global_action_buttons: list[ttk.Button] = []
        self.message_var = tk.StringVar(value="准备就绪")
        self.port_var = tk.StringVar()
        self.log_service_var = tk.StringVar(value=self.controller.services[0].label)
        self.log_meta_var = tk.StringVar(value="日志面板准备就绪")
        self.port_kill_button: ttk.Button | None = None
        self.log_refresh_button: ttk.Button | None = None
        self.log_text: scrolledtext.ScrolledText | None = None
        self.service_locks: dict[str, threading.Lock] = {}
        self.global_action_lock = threading.Lock()
        self.port_lock = threading.Lock()
        self.status_lock = threading.Lock()
        self.log_lock = threading.Lock()
        self.priority_count = 0
        self.priority_lock = threading.Lock()

        self.root.title("OneCEO 服务控制台")
        self.root.geometry("1220x820")
        self.root.minsize(1080, 700)

        self._build_ui()
        self._schedule_status_refresh()
        self._schedule_log_refresh()
        self._request_status_refresh()
        self._request_log_refresh()
        self._poll_queue()

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)

        container = ttk.Frame(self.root, padding=18)
        container.grid(sticky="nsew")
        container.columnconfigure(0, weight=1)
        container.rowconfigure(4, weight=1)

        header = ttk.Frame(container)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)

        ttk.Label(header, text="OneCEO 本地服务管理器", font=("PingFang SC", 18, "bold")).grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(header, text=f"仓库路径：{self.controller.repo_root}", foreground="#475569").grid(
            row=1, column=0, sticky="w", pady=(4, 0)
        )

        toolbar = ttk.Frame(container)
        toolbar.grid(row=1, column=0, sticky="ew", pady=(16, 12))

        for index, (label, action) in enumerate(
            (
                ("全部启动", lambda: self._run_all("start")),
                ("全部停止", lambda: self._run_all("stop")),
                ("全部重启", lambda: self._run_all("restart")),
                ("刷新状态", self._request_status_refresh),
            )
        ):
            button = ttk.Button(toolbar, text=label, command=action)
            button.grid(row=0, column=index, padx=(0, 8))
            self.global_action_buttons.append(button)

        services_frame = ttk.Frame(container)
        services_frame.grid(row=2, column=0, sticky="nsew")
        services_frame.columnconfigure(2, weight=1)

        headers = ("服务", "状态", "URL", "端口", "PID", "操作")
        for column, title in enumerate(headers):
            ttk.Label(services_frame, text=title, font=("PingFang SC", 11, "bold")).grid(
                row=0, column=column, sticky="w", padx=(0, 12), pady=(0, 8)
            )

        for row, service in enumerate(self.controller.services, start=1):
            service_row = row * 2 - 1
            detail_row = service_row + 1
            self.service_locks[service.key] = threading.Lock()
            self.service_action_buttons[service.key] = []
            name_label = ttk.Label(services_frame, text=service.label)
            name_label.grid(row=service_row, column=0, sticky="w", padx=(0, 12), pady=(8, 2))

            state_var = tk.StringVar(value="检测中")
            detail_var = tk.StringVar(value="-")
            pid_var = tk.StringVar(value="-")
            hint_var = tk.StringVar(value=self._policy_hint_text())

            state_label = ttk.Label(services_frame, textvariable=state_var)
            state_label.grid(row=service_row, column=1, sticky="w", padx=(0, 12))

            url_label = tk.Label(
                services_frame,
                text=service.url,
                fg="#2563eb",
                cursor="hand2",
                font=("Menlo", 11),
            )
            url_label.bind("<Button-1>", lambda _event, url=service.url: webbrowser.open(url))
            url_label.grid(row=service_row, column=2, sticky="w", padx=(0, 12))

            ttk.Label(services_frame, text=str(service.port), font=("Menlo", 11)).grid(
                row=service_row, column=3, sticky="w", padx=(0, 12)
            )
            ttk.Label(services_frame, textvariable=pid_var, font=("Menlo", 11)).grid(
                row=service_row, column=4, sticky="w", padx=(0, 12)
            )

            actions = ttk.Frame(services_frame)
            actions.grid(row=service_row, column=5, sticky="w")

            for text, callback in (
                ("启动", lambda key=service.key: self._run_service("start", key)),
                ("停止", lambda key=service.key: self._run_service("stop", key)),
                ("重启", lambda key=service.key: self._run_service("restart", key)),
                ("打开", lambda url=service.url: webbrowser.open(url)),
            ):
                button = ttk.Button(actions, text=text, command=callback)
                button.pack(side="left", padx=(0, 6))
                if text != "打开":
                    self.service_action_buttons[service.key].append(button)

            detail_label = ttk.Label(services_frame, textvariable=detail_var, foreground="#64748b")
            detail_label.grid(row=detail_row, column=0, columnspan=3, sticky="w", pady=(0, 8))
            hint_label = ttk.Label(services_frame, textvariable=hint_var, foreground="#9a3412")
            hint_label.grid(row=detail_row, column=3, columnspan=3, sticky="w", pady=(0, 8))

            self.status_vars[service.key] = {
                "state": state_var,
                "detail": detail_var,
                "pid": pid_var,
                "hint": hint_var,
            }
            self.state_labels[service.key] = state_label

        port_frame = ttk.Labelframe(container, text="强行释放端口", padding=12)
        port_frame.grid(row=3, column=0, sticky="ew", pady=(16, 0))

        ttk.Label(port_frame, text="端口号").grid(row=0, column=0, sticky="w")
        port_entry = ttk.Entry(port_frame, textvariable=self.port_var, width=14)
        port_entry.grid(row=0, column=1, sticky="w", padx=(8, 12))
        kill_button = ttk.Button(port_frame, text="强杀进程", command=self._kill_port)
        kill_button.grid(row=0, column=2, sticky="w")
        self.port_kill_button = kill_button

        log_frame = ttk.Labelframe(container, text="服务日志", padding=12)
        log_frame.grid(row=4, column=0, sticky="nsew", pady=(16, 0))
        log_frame.columnconfigure(1, weight=1)
        log_frame.columnconfigure(3, weight=1)
        log_frame.rowconfigure(1, weight=1)

        ttk.Label(log_frame, text="查看服务").grid(row=0, column=0, sticky="w")
        log_selector = ttk.Combobox(
            log_frame,
            state="readonly",
            textvariable=self.log_service_var,
            values=[service.label for service in self.controller.services],
            width=18,
        )
        log_selector.grid(row=0, column=1, sticky="w", padx=(8, 12))
        log_selector.bind("<<ComboboxSelected>>", lambda _event: self._request_log_refresh())

        refresh_log_button = ttk.Button(log_frame, text="刷新日志", command=self._request_log_refresh)
        refresh_log_button.grid(row=0, column=2, sticky="w")
        self.log_refresh_button = refresh_log_button

        ttk.Label(log_frame, textvariable=self.log_meta_var, foreground="#475569").grid(
            row=0, column=3, sticky="e", padx=(12, 0)
        )

        self.log_text = scrolledtext.ScrolledText(
            log_frame,
            wrap=tk.WORD,
            height=14,
            font=("Menlo", 11),
            state="disabled",
        )
        self.log_text.grid(row=1, column=0, columnspan=4, sticky="nsew", pady=(10, 0))

        footer = ttk.Label(container, textvariable=self.message_var, foreground="#0f172a")
        footer.grid(row=5, column=0, sticky="ew", pady=(16, 0))

    def _policy_hint_text(self) -> str:
        return f"策略：超时自动重试 {START_RETRY_LIMIT} 次；失败可直接重试；按钮操作优先；必要时强制释放端口"

    def _selected_log_service_key(self) -> str:
        label = self.log_service_var.get()
        for service in self.controller.services:
            if service.label == label:
                return service.key
        return self.controller.services[0].key

    def _set_buttons_state(self, buttons: list[ttk.Button], busy: bool) -> None:
        for button in buttons:
            button.state(["disabled"] if busy else ["!disabled"])

    def _set_service_busy(self, service_key: str, busy: bool) -> None:
        self._set_buttons_state(self.service_action_buttons.get(service_key, []), busy)

    def _set_global_busy(self, busy: bool) -> None:
        self._set_buttons_state(self.global_action_buttons[:3], busy)

    def _set_port_busy(self, busy: bool) -> None:
        if self.port_kill_button is not None:
            self._set_buttons_state([self.port_kill_button], busy)

    def _set_log_busy(self, busy: bool) -> None:
        if self.log_refresh_button is not None:
            self._set_buttons_state([self.log_refresh_button], busy)

    def _set_priority_busy(self, busy: bool) -> None:
        with self.priority_lock:
            if busy:
                self.priority_count += 1
            else:
                self.priority_count = max(0, self.priority_count - 1)

    def _priority_actions_running(self) -> bool:
        with self.priority_lock:
            return self.priority_count > 0

    def _schedule_status_refresh(self) -> None:
        self.root.after(2000, self._on_status_timer)

    def _on_status_timer(self) -> None:
        self._request_status_refresh()
        self._schedule_status_refresh()

    def _schedule_log_refresh(self) -> None:
        self.root.after(LOG_REFRESH_INTERVAL_MS, self._on_log_timer)

    def _on_log_timer(self) -> None:
        self._request_log_refresh()
        self._schedule_log_refresh()

    def _apply_status_snapshot(self, snapshot: dict[str, ServiceStatus]) -> None:
        for service in self.controller.services:
            status = snapshot.get(service.key)
            if status is None:
                continue

            refs = self.status_vars[service.key]
            refs["state"].set(status.text)
            refs["detail"].set(status.detail)
            refs["pid"].set(status.pid_text)

            widget = self.state_labels[service.key]
            if status.state == "running":
                widget.configure(foreground="#15803d")
            elif status.state == "occupied":
                widget.configure(foreground="#b45309")
            elif status.state == "starting":
                widget.configure(foreground="#2563eb")
            elif status.state == "error":
                widget.configure(foreground="#dc2626")
            else:
                widget.configure(foreground="#64748b")

    def _apply_log_payload(self, payload: dict[str, str]) -> None:
        if payload["service_key"] != self._selected_log_service_key():
            return

        if self.log_text is None:
            return

        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", tk.END)
        self.log_text.insert("1.0", payload["content"])
        self.log_text.see(tk.END)
        self.log_text.configure(state="disabled")
        self.log_meta_var.set(payload["meta"])

    def _poll_queue(self) -> None:
        try:
            while True:
                kind, payload = self.queue.get_nowait()
                if kind == "status":
                    self._apply_status_snapshot(payload)
                elif kind == "log":
                    self._apply_log_payload(payload)
                elif kind == "result":
                    target_type = payload["target_type"]
                    target = payload["target"]
                    message = payload["message"]
                    error = payload["error"]

                    if target_type == "service":
                        self._set_service_busy(target, False)
                    elif target_type == "global":
                        self._set_global_busy(False)
                    elif target_type == "port":
                        self._set_port_busy(False)

                    if target_type in {"service", "global", "port"}:
                        self._set_priority_busy(False)

                    if target_type == "service":
                        service_key = payload["service_key"]
                        action = payload["action"]
                        hint_var = self.status_vars[service_key]["hint"]
                        if error:
                            if action in {"start", "restart"}:
                                hint_var.set(
                                    f"最近失败：已自动重试 {START_RETRY_LIMIT} 次；可继续点重试；建议看下方日志"
                                )
                            else:
                                hint_var.set("最近失败：系统层强制停止未完成；建议看下方日志后重试")
                        else:
                            hint_var.set(self._policy_hint_text())
                        self.log_service_var.set(self.controller.service_map[service_key].label)
                        self._request_log_refresh()

                    self.message_var.set(message)
                    if error:
                        messagebox.showerror("操作失败", message)
                elif kind == "service-busy":
                    self._set_service_busy(payload["service_key"], payload["busy"])
                elif kind == "log-busy":
                    self._set_log_busy(bool(payload))
                elif kind == "message":
                    self.message_var.set(payload)
        except Empty:
            pass

        self.root.after(200, self._poll_queue)

    def _request_status_refresh(self) -> None:
        if self._priority_actions_running():
            return
        if not self.status_lock.acquire(blocking=False):
            return

        def worker() -> None:
            try:
                snapshot = self.controller.all_statuses()
                self.queue.put(("status", snapshot))
            finally:
                self.status_lock.release()

        threading.Thread(target=worker, daemon=True).start()

    def _request_log_refresh(self) -> None:
        if not self.log_lock.acquire(blocking=False):
            return

        service_key = self._selected_log_service_key()
        self._set_log_busy(True)

        def worker() -> None:
            try:
                content = self.controller.log_tail(service_key)
                service = self.controller.service_map[service_key]
                meta = f"{service.label} 日志：{service.log_file} | {time.strftime('%H:%M:%S')}"
                self.queue.put(("log", {"service_key": service_key, "content": content, "meta": meta}))
            finally:
                self.log_lock.release()
                self.queue.put(("log-busy", False))

        threading.Thread(target=worker, daemon=True).start()

    def _submit_operation(
        self,
        target_type: str,
        target: str,
        busy_handler: Callable[[bool], None],
        func: Callable[[], str],
        action_name: str,
    ) -> None:
        busy_handler(True)
        self._set_priority_busy(True)

        def worker() -> None:
            try:
                message = func()
            except Exception as exc:
                self.queue.put(
                    (
                        "result",
                        {
                            "target_type": target_type,
                            "target": target,
                            "service_key": target,
                            "action": action_name,
                            "message": str(exc),
                            "error": True,
                        },
                    )
                )
            else:
                self.queue.put(
                    (
                        "result",
                        {
                            "target_type": target_type,
                            "target": target,
                            "service_key": target,
                            "action": action_name,
                            "message": message,
                            "error": False,
                        },
                    )
                )

        threading.Thread(target=worker, daemon=True).start()

    def _run_service(self, action: str, service_key: str) -> None:
        service = self.controller.service_map[service_key]
        lock = self.service_locks[service_key]
        if not lock.acquire(blocking=False):
            messagebox.showwarning("操作冲突", f"{service.label} 正在执行其他操作。")
            return

        action_text = {"start": "启动", "stop": "停止", "restart": "重启"}[action]
        self.message_var.set(f"{action_text} {service.label} 中...")
        self.status_vars[service_key]["hint"].set(
            f"执行中：按钮操作优先；{action_text} 超时会自动重试；必要时会强制释放端口"
        )
        self.log_service_var.set(service.label)
        self._request_log_refresh()

        def runner() -> str:
            try:
                return getattr(self.controller, action)(service_key)
            finally:
                lock.release()

        self._submit_operation(
            "service",
            service_key,
            lambda busy: self._set_service_busy(service_key, busy),
            runner,
            action,
        )

    def _run_all(self, action: str) -> None:
        if not self.global_action_lock.acquire(blocking=False):
            messagebox.showwarning("操作冲突", "批量操作正在执行，请稍后。")
            return

        text_map = {"start": "全部启动", "stop": "全部停止", "restart": "全部重启"}
        self.message_var.set(f"{text_map[action]} 中...")

        def runner() -> str:
            messages: list[str] = []
            order_map = {
                "start": ("api", "web", "admin-api", "admin-web"),
                "stop": ("admin-web", "admin-api", "web", "api"),
                "restart": ("api", "web", "admin-api", "admin-web"),
            }

            try:
                for service_key in order_map[action]:
                    service = self.controller.service_map[service_key]
                    lock = self.service_locks[service_key]
                    if not lock.acquire(blocking=False):
                        messages.append(f"{service.label} 跳过：该服务正在执行其他操作。")
                        continue

                    self.queue.put(("service-busy", {"service_key": service_key, "busy": True}))
                    self.queue.put(("message", f"{text_map[action]} 中，当前处理：{service.label}"))
                    try:
                        messages.append(getattr(self.controller, action)(service_key))
                    except Exception as exc:
                        messages.append(f"{service.label} 失败：{exc}")
                    finally:
                        self.queue.put(("service-busy", {"service_key": service_key, "busy": False}))
                        lock.release()

                return "\n".join(messages)
            finally:
                self.global_action_lock.release()

        self._submit_operation("global", action, self._set_global_busy, runner, action)

    def _kill_port(self) -> None:
        raw_port = self.port_var.get().strip()
        if not raw_port.isdigit():
            messagebox.showwarning("输入错误", "请输入有效端口号。")
            return

        if not self.port_lock.acquire(blocking=False):
            messagebox.showwarning("操作冲突", "端口强杀任务正在执行，请稍后。")
            return

        port = int(raw_port)
        self.message_var.set(f"强杀端口 {port} 中...")

        def runner() -> str:
            try:
                return self.controller.kill_port(port)
            finally:
                self.port_lock.release()

        self._submit_operation("port", str(port), self._set_port_busy, runner, "kill-port")


def run_cli(controller: ServiceController, args: argparse.Namespace) -> int:
    if args.self_check:
        print(f"repo_root={controller.repo_root}")
        for service in controller.services:
            status = controller.status(service.key)
            print(
                f"{service.key}: state={status.state} text={status.text} port={service.port} url={service.url} pid={status.pid_text}"
            )
        return 0

    if args.action and args.service:
        if args.service == "all":
            messages = controller.all_services(args.action)
            print("\n".join(messages))
            return 0

        message = getattr(controller, args.action)(args.service)
        print(message)
        return 0

    if args.kill_port is not None:
        print(controller.kill_port(args.kill_port))
        return 0

    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="OneCEO local service manager GUI")
    parser.add_argument("--self-check", action="store_true", help="Print resolved service status and exit")
    parser.add_argument("--action", choices=("start", "stop", "restart"), help="Run a CLI action and exit")
    parser.add_argument(
        "--service",
        choices=("web", "api", "admin-web", "admin-api", "all"),
        help="Target service for --action",
    )
    parser.add_argument("--kill-port", type=int, help="Force-kill any process listening on the given port")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        repo_root = resolve_repo_root()
        controller = ServiceController(repo_root)
    except Exception as exc:
        if args.self_check or args.action or args.kill_port is not None:
            print(str(exc), file=sys.stderr)
            return 1

        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("启动失败", str(exc))
        root.destroy()
        return 1

    if args.self_check or args.action or args.kill_port is not None:
        return run_cli(controller, args)

    root = tk.Tk()
    app = ServiceManagerApp(root, controller)
    _ = app
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
