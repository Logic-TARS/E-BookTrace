# ZeroTier Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个由 Python 统一实现、Windows/Linux 启动入口共同调用的运行时验证层，使 Marginalia 只绑定显式配置且经网卡身份确认的本机 ZeroTier IPv4 地址与端口。

**Architecture:** 新建 `backend/runtime.py` 作为唯一配置、网卡身份、地址归属、端口占用与 Uvicorn 启动参数来源；Windows 使用 PowerShell `Get-NetAdapter` + `Get-NetIPAddress` 生成结构化接口信息，POSIX 使用 `zerotier-cli` 网络成员身份与系统接口地址的交集，绝不按 `10.*` 前缀猜测。`start.bat`、`start.sh` 和 `python backend/main.py` 都调用相同 Python API；脚本只负责 Python 3.11/.venv 引导、缺失 `.env` 模板复制和打开浏览器。

**Tech Stack:** Python 3.11 标准库（`argparse`、`ipaddress`、`json`、`socket`、`subprocess`）、python-dotenv、Uvicorn、FastAPI、pytest、Windows Batch、Bash、PowerShell、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-23-local-zerotier-no-ai-design.md`

## Global Constraints

- 执行顺序固定为 `remove-ai-core → zerotier-runtime → local-operations-cleanup`；开始本计划前，`2026-09-23-remove-ai-core.md` 的 pytest 与 Playwright 必须全绿。
- `SERVER_HOST` 必须显式配置为本机当前拥有且由 ZeroTier 网卡身份确认的单播 IPv4；不得按 `10.*`、`172.16/12` 或任何地址前缀推断 ZeroTier。
- Windows 网卡身份以 `Get-NetAdapter` 的 `InterfaceDescription`、`Name` 或 `DriverDescription` 包含 `ZeroTier` 为准，再按相同 `InterfaceIndex` 连接 `Get-NetIPAddress`；普通 LAN 上即使配置了相同私网段也必须拒绝。
- POSIX 网卡身份以 `zerotier-cli listnetworks -j` 返回的 `portDeviceName` 与 `assignedAddresses` 为准，并与系统接口实际 IPv4 地址求交集；`zerotier-cli` 缺失、JSON 不可解析或没有在线网络时必须失败。
- 明确拒绝 `0.0.0.0`、`127.0.0.0/8`、IPv6、广播/组播/未指定地址、普通 LAN 地址；校验失败不得回退到其他地址、localhost 或所有网卡。
- `SERVER_PORT` 必须显式或以模板值 `8720` 配置，解析范围 `1..65535`；目标 `<host,port>` 已监听时必须失败并显示地址与端口。
- `CORS_ORIGINS` 与 `ALLOWED_HOSTS` 继续显式配置；运行时不得自动扩大为 `*`。
- 不加入 TLS、证书、反向代理或 HTTPS 配置。`http://<ZeroTier-IP>:8720` 通常不属于浏览器安全上下文，远端 EPUB 阅读/同步验收与 Service Worker/PWA 安全上下文验收必须分开记录。
- `.env.production` 是敏感本地文件：不读取、不打印、不修改、不删除；不自动创建或提交用户真实 `.env`。
- `start.bat` 缺失 `.env` 时可以从 `.env.example` 复制占位模板，但必须立即因未替换的 `SERVER_HOST` 失败；脚本不得猜测真实地址。
- 真实 pytest 继续使用进程级 `ALLOWED_HOSTS=localhost,127.0.0.1,testserver` 与 `CORS_ORIGINS=http://testserver` 隔离项目根 `.env`。
- 每个任务严格 TDD：失败测试→观察失败→最小实现→通过→独立提交。
- 本计划中的 `git commit` 是未来执行步骤；编写计划时不执行任何提交。

---

## Prerequisite Verification: 锁定 remove-ai-core 交接基线

**Files:**
- Inspect: `backend/main.py`
- Inspect: `backend/config.py`
- Inspect: `backend/tests/test_api.py`
- Inspect: `frontend/tests/app-shell-versions.spec.js`
- Create during execution: `.git/zerotier-runtime-baseline.txt`（仅本地、不提交）

**Interfaces:**
- Consumes: AI-free 后端与前端、现有 `.venv`。
- Produces: 本计划可执行的干净测试基线；不依赖真实 `.env` 内容。

- [ ] **Step 1: 确认前序计划已完成且 AI 模块不存在**

Run:

```bash
test ! -e backend/knowledge.py
test ! -e backend/llm.py
python -c "from pathlib import Path; t=Path('backend/main.py').read_text(encoding='utf-8'); assert '/api/knowledge/' not in t and '/api/books/ask' not in t"
```

Expected: all commands exit 0。

- [ ] **Step 2: 运行隔离后的后端基线**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: all collected tests PASS；不得再出现已知 TrustedHost 失败。

- [ ] **Step 3: 运行前端聚焦基线**

Run:

```bash
cd frontend && npx playwright test tests/book-chat.spec.js tests/server-sync.spec.js tests/import-ux.spec.js tests/app-shell-versions.spec.js
```

Expected: `28 passed`（book-chat 20、server-sync 4、import-ux 3、app-shell-versions 1）。

- [ ] **Step 4: 记录基线但不提交**

Run:

```bash
{
  date -Iseconds
  git rev-parse HEAD
  printf '%s\n' 'remove-ai-core handoff: backend and focused frontend green'
} > .git/zerotier-runtime-baseline.txt
git status --short
```

Expected: `.git/zerotier-runtime-baseline.txt` 不出现在状态中。

---

### Task 1: 在 config 中正式加入 SERVER_HOST/SERVER_PORT

**Files:**
- Modify: `backend/config.py`
- Modify: `backend/tests/test_config.py`

**Interfaces:**
- Consumes: `os.environ` 与项目根 `.env`（生产运行时）；测试通过 monkeypatch 与禁用 dotenv 隔离。
- Produces: `settings.server_host: str`、`settings.server_port: str`；配置模块只读取原始字符串，不会因非法端口在 import 时抛 `ValueError`，所有解析错误由 `parse_server_config(host: str, port: str) -> RuntimeConfig` 转成 `RuntimeConfigError`。

- [ ] **Step 1: 写配置解析失败测试**

Add to `backend/tests/test_config.py` and include `SERVER_HOST`, `SERVER_PORT` in `_load_settings.names`:

```python
def test_server_binding_settings_are_loaded_as_raw_strings(monkeypatch):
    settings = _load_settings(monkeypatch, {
        "SERVER_HOST": "172.23.44.5",
        "SERVER_PORT": "9876",
    })
    assert settings.server_host == "172.23.44.5"
    assert settings.server_port == "9876"


def test_invalid_server_port_does_not_crash_config_import(monkeypatch):
    settings = _load_settings(monkeypatch, {"SERVER_PORT": "not-a-port"})
    assert settings.server_port == "not-a-port"


def test_server_binding_defaults_do_not_open_any_interface(monkeypatch):
    settings = _load_settings(monkeypatch, {})
    assert settings.server_host == ""
    assert settings.server_port == "8720"
```

- [ ] **Step 2: 运行测试并确认字段不存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_config.py -q
```

Expected: FAIL with `AttributeError: 'Settings' object has no attribute 'server_host'`。

- [ ] **Step 3: 添加最小配置字段**

Add to `Settings` in `backend/config.py`:

```python
    server_host: str = os.getenv("SERVER_HOST", "").strip()
    server_port: str = os.getenv("SERVER_PORT", "8720").strip()
```

Do not validate adapter identity in `config.py`; keeping identity validation in `runtime.py` prevents three entry points from diverging。

- [ ] **Step 4: 运行 config 测试**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_config.py -q
```

Expected: all tests PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/config.py backend/tests/test_config.py
git commit -m "Add explicit server binding settings"
```

---

### Task 2: 实现纯函数级 ZeroTier 网卡身份与地址验证

**Files:**
- Create: `backend/runtime.py`
- Create: `backend/tests/test_runtime.py`

**Interfaces:**
- Consumes: normalized interface records `InterfaceAddress(interface_index: int, name: str, description: str, driver_description: str, address: IPv4Address)`。
- Produces: `RuntimeConfig(host: str, port: int)`；`RuntimeConfigError`；`parse_server_config(host: str, port: str) -> RuntimeConfig`；`select_zerotier_ipv4(configured_host: str, interfaces: Sequence[InterfaceAddress]) -> IPv4Address`。

- [ ] **Step 1: 写 host/port 与网卡身份失败测试**

Create `backend/tests/test_runtime.py`:

```python
from ipaddress import IPv4Address

import pytest

from runtime import (
    InterfaceAddress,
    RuntimeConfigError,
    parse_server_config,
    select_zerotier_ipv4,
)


def iface(address: str, *, name: str = "ZeroTier One [abcdef]", description: str = "ZeroTier Virtual Port", driver: str = "ZeroTier Virtual Port"):
    return InterfaceAddress(42, name, description, driver, IPv4Address(address))


def test_parse_server_config_accepts_explicit_ipv4_and_port():
    assert parse_server_config("172.23.44.5", "8720").host == "172.23.44.5"
    assert parse_server_config("172.23.44.5", "8720").port == 8720


@pytest.mark.parametrize(
    "host",
    ["", "0.0.0.0", "127.0.0.1", "::1", "reader.local", "224.0.0.1", "169.254.1.2", "255.255.255.255", "192.0.2.10"],
)
def test_parse_server_config_rejects_unsafe_hosts(host):
    with pytest.raises(RuntimeConfigError):
        parse_server_config(host, "8720")


@pytest.mark.parametrize("port", ["", "0", "65536", "http", "-1"])
def test_parse_server_config_rejects_invalid_ports(port):
    with pytest.raises(RuntimeConfigError):
        parse_server_config("172.23.44.5", port)


def test_select_accepts_configured_address_on_identified_zerotier_adapter():
    selected = select_zerotier_ipv4("172.23.44.5", [iface("172.23.44.5")])
    assert selected == IPv4Address("172.23.44.5")


def test_select_does_not_guess_10_prefix_or_accept_lan_adapter():
    interfaces = [InterfaceAddress(7, "Wi-Fi", "Intel Wi-Fi", "Intel Wi-Fi", IPv4Address("10.20.30.40"))]
    with pytest.raises(RuntimeConfigError, match="ZeroTier"):
        select_zerotier_ipv4("10.20.30.40", interfaces)


def test_select_rejects_other_local_address_when_zerotier_is_present():
    interfaces = [
        iface("172.23.44.5"),
        InterfaceAddress(7, "Ethernet", "Realtek LAN", "Realtek LAN", IPv4Address("192.168.1.20")),
    ]
    with pytest.raises(RuntimeConfigError, match="172.23.44.5"):
        select_zerotier_ipv4("192.168.1.20", interfaces)
```

- [ ] **Step 2: 运行测试并确认 runtime 模块不存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py -q
```

Expected: collection FAIL with `ModuleNotFoundError: No module named 'runtime'`。

- [ ] **Step 3: 创建数据类型、配置解析和身份判定**

Create the initial `backend/runtime.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from ipaddress import IPv4Address, ip_address
from typing import Sequence


class RuntimeConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class RuntimeConfig:
    host: str
    port: int


@dataclass(frozen=True)
class InterfaceAddress:
    interface_index: int
    name: str
    description: str
    driver_description: str
    address: IPv4Address


def parse_server_config(host: str, port: str) -> RuntimeConfig:
    value = str(host or "").strip()
    if not value:
        raise RuntimeConfigError("SERVER_HOST is required in .env")
    try:
        address = ip_address(value)
    except ValueError as exc:
        raise RuntimeConfigError(f"SERVER_HOST must be a valid IPv4 address: {value}") from exc
    if not isinstance(address, IPv4Address):
        raise RuntimeConfigError("SERVER_HOST must be an IPv4 address")
    if (
        address.is_unspecified
        or address.is_loopback
        or address.is_multicast
        or address.is_link_local
        or address.is_reserved
        or int(address) == 0xFFFFFFFF
    ):
        raise RuntimeConfigError(
            "SERVER_HOST must be a unicast IPv4 address and cannot be all-interfaces, loopback, link-local, multicast, broadcast, or reserved"
        )
    try:
        parsed_port = int(str(port).strip())
    except ValueError as exc:
        raise RuntimeConfigError("SERVER_PORT must be an integer") from exc
    if not 1 <= parsed_port <= 65535:
        raise RuntimeConfigError("SERVER_PORT must be between 1 and 65535")
    return RuntimeConfig(str(address), parsed_port)


def _is_zerotier_interface(interface: InterfaceAddress) -> bool:
    identity = " ".join((interface.name, interface.description, interface.driver_description)).casefold()
    return "zerotier" in identity


def select_zerotier_ipv4(configured_host: str, interfaces: Sequence[InterfaceAddress]) -> IPv4Address:
    target = IPv4Address(configured_host)
    zerotier_addresses = sorted(
        {item.address for item in interfaces if _is_zerotier_interface(item)},
        key=str,
    )
    if target in zerotier_addresses:
        return target
    available = ", ".join(map(str, zerotier_addresses)) or "none"
    raise RuntimeConfigError(
        f"SERVER_HOST {target} is not assigned to a local ZeroTier adapter; available ZeroTier IPv4 addresses: {available}"
    )
```

- [ ] **Step 4: 运行纯函数测试**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py -q
```

Expected: all current tests PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/runtime.py backend/tests/test_runtime.py
git commit -m "Validate explicit ZeroTier server addresses"
```

---

### Task 3: 实现 Windows ZeroTier 网卡枚举，不按地址段猜测

**Files:**
- Modify: `backend/runtime.py`
- Modify: `backend/tests/test_runtime.py`

**Interfaces:**
- Consumes: PowerShell JSON fields `InterfaceIndex`, `Name`, `InterfaceDescription`, `DriverDescription`, `IPAddress` joined by adapter index。
- Produces: `run_command(command: list[str]) -> subprocess.CompletedProcess[str]` 与 `list_windows_interfaces(runner: Callable[[list[str]], subprocess.CompletedProcess[str]] = run_command) -> list[InterfaceAddress]`；PowerShell 非零退出和非法 JSON立即转为 `RuntimeConfigError`。

- [ ] **Step 1: 写 PowerShell JSON 解析失败测试**

Add to `backend/tests/test_runtime.py`:

```python
import subprocess

from runtime import list_windows_interfaces


def test_windows_interfaces_join_adapter_identity_to_ip_by_index():
    payload = """[
      {"InterfaceIndex":42,"Name":"ZeroTier One [abcd]","InterfaceDescription":"ZeroTier Virtual Port","DriverDescription":"ZeroTier Virtual Port","IPAddress":"172.23.44.5"},
      {"InterfaceIndex":7,"Name":"Wi-Fi","InterfaceDescription":"Intel Wi-Fi","DriverDescription":"Intel Wi-Fi","IPAddress":"10.20.30.40"}
    ]"""
    calls = []

    def fake_run(command: list[str]) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, payload, "")

    interfaces = list_windows_interfaces(fake_run)
    assert interfaces[0].interface_index == 42
    assert interfaces[0].name.startswith("ZeroTier One")
    assert interfaces[0].address == IPv4Address("172.23.44.5")
    assert "Get-NetAdapter" in calls[0][-1]
    assert "Get-NetIPAddress" in calls[0][-1]


def test_windows_interface_command_failure_is_not_silently_ignored():
    def fake_run(command: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(command, 1, "", "Access denied")

    with pytest.raises(RuntimeConfigError, match="Access denied"):
        list_windows_interfaces(fake_run)
```

- [ ] **Step 2: 运行测试并确认函数不存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py -q
```

Expected: collection FAIL importing `list_windows_interfaces`。

- [ ] **Step 3: 实现 PowerShell 命令与 JSON 解析**

Add imports `json`, `subprocess`, and `Callable`, then define the concrete runner before the PowerShell script:

```python
CommandRunner = Callable[[list[str]], subprocess.CompletedProcess[str]]


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False)


WINDOWS_INTERFACE_SCRIPT = r"""
$adapters = Get-NetAdapter -IncludeHidden | Select-Object InterfaceIndex,Name,InterfaceDescription,DriverDescription
$addresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' }
$result = foreach ($address in $addresses) {
  $adapter = $adapters | Where-Object { $_.InterfaceIndex -eq $address.InterfaceIndex } | Select-Object -First 1
  if ($adapter) {
    [pscustomobject]@{
      InterfaceIndex = [int]$adapter.InterfaceIndex
      Name = [string]$adapter.Name
      InterfaceDescription = [string]$adapter.InterfaceDescription
      DriverDescription = [string]$adapter.DriverDescription
      IPAddress = [string]$address.IPAddress
    }
  }
}
@($result) | ConvertTo-Json -Compress
"""


def list_windows_interfaces(
    runner: CommandRunner = run_command,
) -> list[InterfaceAddress]:
    completed = runner(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_INTERFACE_SCRIPT]
    )
    if completed.returncode:
        raise RuntimeConfigError(
            f"Could not enumerate Windows network adapters: {completed.stderr.strip()}"
        )
    try:
        records = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise RuntimeConfigError("Windows adapter query returned invalid JSON") from exc
    if isinstance(records, dict):
        records = [records]
    return [
        InterfaceAddress(
            int(item["InterfaceIndex"]),
            str(item.get("Name") or ""),
            str(item.get("InterfaceDescription") or ""),
            str(item.get("DriverDescription") or ""),
            IPv4Address(item["IPAddress"]),
        )
        for item in records
    ]
```

The selection still happens through `select_zerotier_ipv4`; do not filter by `10.` in PowerShell or Python。

- [ ] **Step 4: 运行 runtime tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py -q
```

Expected: all tests PASS。

- [ ] **Step 5: 在 Windows 主机上只列出接口名称，不输出环境文件**

Run:

```bash
.venv/Scripts/python.exe -c "import sys; sys.path.insert(0,'backend'); from runtime import list_windows_interfaces; print([(x.interface_index,x.name,str(x.address)) for x in list_windows_interfaces()])"
```

Expected: output includes actual adapters；ZeroTier adapter identity is visible by name/description linkage。This command does not assert a particular address and does not read `.env`。

- [ ] **Step 6: Commit**

```bash
git add backend/runtime.py backend/tests/test_runtime.py
git commit -m "Identify ZeroTier addresses from Windows adapters"
```

---

### Task 4: 实现 POSIX ZeroTier 身份验证与统一配置加载

**Files:**
- Modify: `backend/runtime.py`
- Modify: `backend/tests/test_runtime.py`

**Interfaces:**
- Consumes: `zerotier-cli listnetworks -j` records (`status`, `portDeviceName`, `assignedAddresses`) and `ip -j -4 addr show` records (`ifindex`, `ifname`, `addr_info[].local`) through `CommandRunner`。
- Produces: `run_json(command: list[str], runner: CommandRunner = run_command) -> object`；`list_posix_zerotier_interfaces(runner: CommandRunner = run_command) -> list[InterfaceAddress]`；`list_local_interfaces() -> list[InterfaceAddress]`；`load_server_config() -> RuntimeConfig`。

- [ ] **Step 1: 写 POSIX 身份交集与统一加载失败测试**

Add to `backend/tests/test_runtime.py`:

```python
from runtime import list_posix_zerotier_interfaces, load_server_config


def test_posix_uses_zerotier_network_device_and_assigned_address_intersection():
    responses = {
        ("zerotier-cli", "listnetworks", "-j"): subprocess.CompletedProcess([], 0, '[{"status":"OK","portDeviceName":"ztabc","assignedAddresses":["172.23.44.5/24"]}]', ""),
        ("ip", "-j", "-4", "addr", "show"): subprocess.CompletedProcess([], 0, '[{"ifindex":9,"ifname":"ztabc","addr_info":[{"family":"inet","local":"172.23.44.5"}]},{"ifindex":7,"ifname":"eth0","addr_info":[{"family":"inet","local":"10.20.30.40"}]}]', ""),
    }
    def fake_run(command: list[str]) -> subprocess.CompletedProcess[str]:
        return responses[tuple(command)]

    interfaces = list_posix_zerotier_interfaces(fake_run)
    assert interfaces == [InterfaceAddress(9, "ztabc", "ZeroTier network interface", "ZeroTier", IPv4Address("172.23.44.5"))]


def test_posix_rejects_address_not_reported_by_zerotier_cli():
    responses = {
        ("zerotier-cli", "listnetworks", "-j"): subprocess.CompletedProcess([], 0, '[{"status":"OK","portDeviceName":"ztabc","assignedAddresses":["172.23.44.5/24"]}]', ""),
        ("ip", "-j", "-4", "addr", "show"): subprocess.CompletedProcess([], 0, '[{"ifindex":9,"ifname":"ztabc","addr_info":[{"family":"inet","local":"172.23.44.6"}]}]', ""),
    }
    def fake_run(command: list[str]) -> subprocess.CompletedProcess[str]:
        return responses[tuple(command)]

    with pytest.raises(RuntimeConfigError, match="no verified IPv4"):
        list_posix_zerotier_interfaces(fake_run)


def test_load_server_config_validates_settings_against_discovered_interfaces(monkeypatch):
    import runtime
    monkeypatch.setattr(runtime.settings, "server_host", "172.23.44.5")
    monkeypatch.setattr(runtime.settings, "server_port", "8720")
    monkeypatch.setattr(runtime, "list_local_interfaces", lambda: [iface("172.23.44.5")])
    assert load_server_config() == runtime.RuntimeConfig("172.23.44.5", 8720)
```

- [ ] **Step 2: 运行 tests 并确认函数不存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py -q
```

Expected: collection FAIL importing the new functions。

- [ ] **Step 3: 实现 POSIX ZeroTier/system 地址交集**

Add:

```python
import platform
from ipaddress import ip_interface
from config import settings


def run_json(
    command: list[str], runner: CommandRunner = run_command
) -> object:
    try:
        completed = runner(command)
    except FileNotFoundError as exc:
        raise RuntimeConfigError(f"Required command not found: {command[0]}") from exc
    if completed.returncode:
        raise RuntimeConfigError(f"{' '.join(command)} failed: {completed.stderr.strip()}")
    try:
        return json.loads(completed.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise RuntimeConfigError(f"{' '.join(command)} returned invalid JSON") from exc


def list_posix_zerotier_interfaces(
    runner: CommandRunner = run_command,
) -> list[InterfaceAddress]:
    networks = run_json(["zerotier-cli", "listnetworks", "-j"], runner)
    system = run_json(["ip", "-j", "-4", "addr", "show"], runner)
    by_name = {
        item.get("ifname"): (
            int(item.get("ifindex", 0)),
            {IPv4Address(addr["local"]) for addr in item.get("addr_info", []) if addr.get("family") == "inet"},
        )
        for item in system
    }
    result = []
    for network in networks:
        if str(network.get("status", "")).upper() != "OK":
            continue
        name = str(network.get("portDeviceName") or "")
        if not name or name not in by_name:
            continue
        index, local_addresses = by_name[name]
        assigned = {
            ip_interface(value).ip for value in network.get("assignedAddresses", [])
            if ":" not in value
        }
        for address in sorted(local_addresses & assigned, key=str):
            result.append(InterfaceAddress(index, name, "ZeroTier network interface", "ZeroTier", address))
    if not result:
        raise RuntimeConfigError("ZeroTier reported no verified IPv4 address on a local interface")
    return result


def list_local_interfaces() -> list[InterfaceAddress]:
    if platform.system() == "Windows":
        return list_windows_interfaces()
    return list_posix_zerotier_interfaces()


def load_server_config() -> RuntimeConfig:
    config = parse_server_config(settings.server_host, settings.server_port)
    select_zerotier_ipv4(config.host, list_local_interfaces())
    return config
```

- [ ] **Step 4: 运行 runtime tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py -q
```

Expected: all tests PASS。

- [ ] **Step 5: 静态证明没有地址前缀启发式**

Run:

```bash
python - <<'PY'
from pathlib import Path
text=Path('backend/runtime.py').read_text(encoding='utf-8')
for forbidden in ('startswith("10.")', "startswith('10.')", '10.0.0.0/8', '192.168.', '172.16.'):
    assert forbidden not in text
PY
```

Expected: exit 0。

- [ ] **Step 6: Commit**

```bash
git add backend/runtime.py backend/tests/test_runtime.py
git commit -m "Verify ZeroTier identity on POSIX hosts"
```

---

### Task 5: 增加精确 host/port 占用校验与 CLI

**Files:**
- Modify: `backend/runtime.py`
- Modify: `backend/tests/test_runtime.py`

**Interfaces:**
- Consumes: `RuntimeConfig` and verified interface address。
- Produces: `ensure_port_available(config: RuntimeConfig, socket_factory=socket.socket) -> None`；CLI commands `python backend/runtime.py validate --format env` and `python backend/runtime.py serve [--reload]`。

- [ ] **Step 1: 写端口校验与 CLI 失败测试**

Add:

```python
import socket

from runtime import RuntimeConfig, ensure_port_available, main


class FakeSocket:
    def __init__(self, error=None):
        self.error = error
        self.bound = None
    def __enter__(self): return self
    def __exit__(self, *_args): return None
    def bind(self, address):
        self.bound = address
        if self.error:
            raise self.error


def test_port_check_binds_exact_configured_endpoint():
    fake = FakeSocket()
    ensure_port_available(RuntimeConfig("172.23.44.5", 8720), lambda *_args: fake)
    assert fake.bound == ("172.23.44.5", 8720)


def test_port_check_reports_exact_endpoint_when_busy():
    with pytest.raises(RuntimeConfigError, match="172.23.44.5:8720"):
        ensure_port_available(
            RuntimeConfig("172.23.44.5", 8720),
            lambda *_args: FakeSocket(OSError(10048, "in use")),
        )


def test_validate_cli_emits_shell_safe_values(monkeypatch, capsys):
    import runtime
    monkeypatch.setattr(runtime, "load_server_config", lambda: RuntimeConfig("172.23.44.5", 8720))
    monkeypatch.setattr(runtime, "ensure_port_available", lambda _config: None)
    assert main(["validate", "--format", "env"]) == 0
    assert capsys.readouterr().out.splitlines() == [
        "SERVER_HOST=172.23.44.5",
        "SERVER_PORT=8720",
        "SERVER_URL=http://172.23.44.5:8720",
    ]
```

- [ ] **Step 2: 运行 tests 并确认函数/CLI 不存在**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py -q
```

Expected: collection FAIL importing `ensure_port_available` or `main`。

- [ ] **Step 3: 实现精确 bind 检查**

Add:

```python
import socket


def ensure_port_available(config: RuntimeConfig, socket_factory=socket.socket) -> None:
    try:
        with socket_factory(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind((config.host, config.port))
    except OSError as exc:
        raise RuntimeConfigError(
            f"SERVER_HOST/SERVER_PORT is unavailable: {config.host}:{config.port}: {exc}"
        ) from exc
```

Do not probe `0.0.0.0` with `config.port` because that would conflate listeners on unrelated interfaces；validation already guarantees the exact host is a ZeroTier adapter address。

- [ ] **Step 4: 实现 validate/serve CLI**

Add:

```python
import argparse


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("--format", choices=("env", "json"), default="json")
    serve = subparsers.add_parser("serve")
    serve.add_argument("--reload", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    config = load_server_config()
    ensure_port_available(config)
    if args.command == "validate":
        if args.format == "env":
            print(f"SERVER_HOST={config.host}")
            print(f"SERVER_PORT={config.port}")
            print(f"SERVER_URL=http://{config.host}:{config.port}")
        else:
            print(json.dumps({"host": config.host, "port": config.port, "url": f"http://{config.host}:{config.port}"}))
        return 0
    import uvicorn
    uvicorn.run("main:app", host=config.host, port=config.port, reload=args.reload, app_dir=str(Path(__file__).parent))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeConfigError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
```

Add required `Path` and `sys` imports。`serve` does not silently alter host/port under any exception。

- [ ] **Step 5: 运行 runtime tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py -q
```

Expected: all tests PASS。

- [ ] **Step 6: 手工验证危险值明确失败**

Run:

```bash
SERVER_HOST=0.0.0.0 SERVER_PORT=8720 .venv/Scripts/python.exe backend/runtime.py validate --format env
SERVER_HOST=127.0.0.1 SERVER_PORT=8720 .venv/Scripts/python.exe backend/runtime.py validate --format env
```

Expected: each exits 2 and prints explicit rejection；neither prints fallback `SERVER_URL`。

- [ ] **Step 7: Commit**

```bash
git add backend/runtime.py backend/tests/test_runtime.py
git commit -m "Add shared ZeroTier runtime validation CLI"
```

---

### Task 6: 让 main.py __main__ 复用统一 runtime

**Files:**
- Modify: `backend/main.py:717-720`
- Modify: `backend/tests/test_runtime.py`

**Interfaces:**
- Consumes: `runtime.main(["serve", "--reload"])`。
- Produces: `python backend/main.py` 与 `python backend/runtime.py serve --reload` 使用同一 adapter/host/port/port-availability validation；不再存在 `host="0.0.0.0"`。

- [ ] **Step 1: 写 main.py 源码契约失败测试**

Add to `backend/tests/test_runtime.py`:

```python
def test_main_module_delegates_direct_execution_to_runtime():
    from pathlib import Path
    source = (Path(__file__).parents[1] / "main.py").read_text(encoding="utf-8")
    assert 'host="0.0.0.0"' not in source
    assert "from runtime import main as runtime_main" in source
    assert 'runtime_main(["serve", "--reload"])' in source
```

- [ ] **Step 2: 运行单测并确认 hard-coded 0.0.0.0 失败**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py::test_main_module_delegates_direct_execution_to_runtime -q
```

Expected: FAIL because `backend/main.py` contains the exact current line `uvicorn.run("main:app", host="0.0.0.0", port=8720, reload=True)`。

- [ ] **Step 3: 替换 __main__**

Replace the bottom block with:

```python
if __name__ == "__main__":
    from runtime import main as runtime_main

    raise SystemExit(runtime_main(["serve", "--reload"]))
```

- [ ] **Step 4: 运行 runtime 与 API tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_runtime.py backend/tests/test_api.py -q
```

Expected: all selected tests PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_runtime.py
git commit -m "Route direct backend startup through runtime validation"
```

---

### Task 7: 改造 Windows start.bat 为可交互与计划任务共用入口

**Files:**
- Modify: `start.bat`
- Create: `backend/tests/test_start_scripts.py`

**Interfaces:**
- Consumes: `runtime.py validate --format env` 输出的三行 `KEY=VALUE` 和 `runtime.py serve --reload`。
- Produces: `start.bat [--no-browser] [--non-interactive]`；默认启动打开浏览器且退出时 pause，计划任务模式不打开浏览器、不 pause、长期前台运行服务。

- [ ] **Step 1: 写参数、临时文件和 fail-closed 源码测试**

Create `backend/tests/test_start_scripts.py`:

```python
from pathlib import Path


ROOT = Path(__file__).parents[2]


def test_start_bat_uses_checked_temp_file_and_background_safe_flags():
    text = (ROOT / "start.bat").read_text(encoding="utf-8")
    assert 'if /I "%~1"=="--no-browser"' in text
    assert 'if /I "%~1"=="--non-interactive"' in text
    assert 'set "VALIDATION_FILE=%TEMP%\\marginalia-runtime-%RANDOM%-%RANDOM%.env"' in text
    assert '"%VENV_PYTHON%" "%PROJECT_ROOT%backend\\runtime.py" validate --format env > "%VALIDATION_FILE%"' in text
    assert 'set "VALIDATION_EXIT=%errorlevel%"' in text
    assert 'for /f "usebackq tokens=1,* delims==" %%A in ("%VALIDATION_FILE%")' in text
    assert 'del /q "%VALIDATION_FILE%"' in text
    assert 'if "%OPEN_BROWSER%"=="1" start "" "%SERVER_URL%"' in text
    assert 'if "%INTERACTIVE%"=="1" pause' in text
    assert '"%VENV_PYTHON%" "%PROJECT_ROOT%backend\\runtime.py" serve --reload' in text
    assert '--host 127.0.0.1' not in text
    assert '--host 0.0.0.0' not in text
    assert 'set "PORT=8720"' not in text
    assert '.env.production' not in text
```

- [ ] **Step 2: 运行测试并确认旧启动逻辑失败**

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests/test_start_scripts.py -q
```

Expected: FAIL because current script has no flags、checked temp file or non-interactive behavior。

- [ ] **Step 3: 在 title 后加入完整参数解析**

Insert after `title Marginalia`:

```bat
set "OPEN_BROWSER=1"
set "INTERACTIVE=1"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--no-browser" (
    set "OPEN_BROWSER=0"
    shift
    goto parse_args
)
if /I "%~1"=="--non-interactive" (
    set "INTERACTIVE=0"
    set "OPEN_BROWSER=0"
    shift
    goto parse_args
)
echo [ERROR] Unknown argument: %~1
exit /b 2

:args_done
```

For every current early error branch that contains `pause`, replace that single line with `if "%INTERACTIVE%"=="1" pause`。

- [ ] **Step 4: 精确替换 env、validator 与启动段**

Replace the current `.env` block with:

```bat
if not exist "%PROJECT_ROOT%.env" (
    echo [INFO] Creating .env from .env.example
    copy "%PROJECT_ROOT%.env.example" "%PROJECT_ROOT%.env" >nul
    echo [ERROR] Set SERVER_HOST to this machine's ZeroTier IPv4 address in .env, then run again.
    if "%INTERACTIVE%"=="1" pause
    exit /b 1
)
```

Delete the fixed `PORT` assignment、PowerShell port probe、fixed browser URL and direct Uvicorn command。After dependency installation insert:

```bat
set "VALIDATION_FILE=%TEMP%\marginalia-runtime-%RANDOM%-%RANDOM%.env"
set "SERVER_HOST="
set "SERVER_PORT="
set "SERVER_URL="

"%VENV_PYTHON%" "%PROJECT_ROOT%backend\runtime.py" validate --format env > "%VALIDATION_FILE%"
set "VALIDATION_EXIT=%errorlevel%"
if not "%VALIDATION_EXIT%"=="0" (
    if exist "%VALIDATION_FILE%" del /q "%VALIDATION_FILE%"
    echo [ERROR] ZeroTier runtime validation failed. Update SERVER_HOST and SERVER_PORT in .env.
    if "%INTERACTIVE%"=="1" pause
    exit /b %VALIDATION_EXIT%
)

for /f "usebackq tokens=1,* delims==" %%A in ("%VALIDATION_FILE%") do (
    if /I "%%A"=="SERVER_HOST" set "SERVER_HOST=%%B"
    if /I "%%A"=="SERVER_PORT" set "SERVER_PORT=%%B"
    if /I "%%A"=="SERVER_URL" set "SERVER_URL=%%B"
)
del /q "%VALIDATION_FILE%"

if not defined SERVER_URL (
    echo [ERROR] Runtime validation did not return SERVER_URL.
    if "%INTERACTIVE%"=="1" pause
    exit /b 1
)

echo [INFO] Python: %VENV_PYTHON%
echo [INFO] Starting server: %SERVER_URL%
if "%OPEN_BROWSER%"=="1" start "" "%SERVER_URL%"
"%VENV_PYTHON%" "%PROJECT_ROOT%backend\runtime.py" serve --reload
set "EXIT_CODE=%errorlevel%"
if "%INTERACTIVE%"=="1" pause
exit /b %EXIT_CODE%
```

The validator command runs directly, captures `%errorlevel%` immediately, and deletes the unique temp file on both success and validator failure。

- [ ] **Step 5: 运行源码测试与非交互失败路径**

Run:

```bash
.venv/Scripts/python.exe -m pytest backend/tests/test_start_scripts.py -q
cmd.exe /d /c "set SERVER_HOST=0.0.0.0&& set SERVER_PORT=8720&& start.bat --no-browser --non-interactive"
test $? -ne 0
```

Expected: pytest PASS；batch command exits nonzero without opening a browser or waiting for input；`ls "$TEMP"/marginalia-runtime-*.env` finds no file created by this run。

- [ ] **Step 6: Commit**

```bash
git add start.bat backend/tests/test_start_scripts.py
git commit -m "Start Windows only on a verified ZeroTier address"
```

---

### Task 8: 改造 start.sh 为等价 fail-closed 入口

**Files:**
- Modify: `start.sh`
- Modify: `backend/tests/test_start_scripts.py`

**Interfaces:**
- Consumes: `runtime.py validate --format env` and `runtime.py serve --reload`。
- Produces: `start.sh [--no-browser]`；POSIX 入口默认不主动打开浏览器，接受 `--no-browser` 作为无害显式选项，缺失 `.env` 时复制模板并立即失败。

- [ ] **Step 1: 添加 start.sh 源码失败测试**

Add:

```python
def test_start_sh_uses_shared_runtime_without_fallback_binding():
    text = (ROOT / "start.sh").read_text(encoding="utf-8")
    assert 'if [[ "${1:-}" == "--no-browser" ]]' in text
    assert 'backend/runtime.py" validate --format env' in text
    assert 'backend/runtime.py" serve --reload' in text
    assert "xdg-open" not in text
    assert "open \"$SERVER_URL\"" not in text
    assert "--host 127.0.0.1" not in text
    assert "--host 0.0.0.0" not in text
    assert "PORT=8720" not in text
    assert ".env.production" not in text
```

- [ ] **Step 2: 运行测试并确认旧 PORT/loopback 失败**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_start_scripts.py -q
```

Expected: new test FAIL。

- [ ] **Step 3: 替换 start.sh 配置与启动段**

After the banner, add this exact accepted-argument check:

```bash
if [[ "${1:-}" == "--no-browser" ]]; then
    shift
fi
if [[ $# -ne 0 ]]; then
    echo "[ERROR] Unknown argument: $1"
    exit 2
fi
```

The script intentionally never opens a browser, so `--no-browser` is an explicit no-op。Retain `start.sh:15-35` byte-for-byte: the `python3.11`/`python3`/`python` candidate loop, `.venv` creation command, and exact Python 3.11 rejection branch all remain in place。Replace missing env handling with:

```bash
if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
    cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
    echo "[ERROR] Set SERVER_HOST to this machine's ZeroTier IPv4 address in .env, then run again."
    exit 1
fi
```

Replace fixed port launch with:

```bash
VALIDATED="$($VENV_PYTHON "$PROJECT_ROOT/backend/runtime.py" validate --format env)"
printf '%s\n' "$VALIDATED"
SERVER_URL="$(printf '%s\n' "$VALIDATED" | while IFS='=' read -r key value; do [[ "$key" == SERVER_URL ]] && printf '%s' "$value"; done)"
if [[ -z "$SERVER_URL" ]]; then
    echo "[ERROR] Runtime validation did not return SERVER_URL."
    exit 1
fi
echo "[INFO] Python: $VENV_PYTHON"
echo "[INFO] Starting server: $SERVER_URL"
exec "$VENV_PYTHON" "$PROJECT_ROOT/backend/runtime.py" serve --reload
```

Do not call `hostname -I`, `ip route`, or select the first private address in shell。

- [ ] **Step 4: 运行 source tests 与 shell syntax check**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_start_scripts.py -q
bash -n start.sh
```

Expected: tests PASS and `bash -n` exits 0。

- [ ] **Step 5: Commit**

```bash
git add start.sh backend/tests/test_start_scripts.py
git commit -m "Start POSIX only on a verified ZeroTier address"
```

---

### Task 9: 更新 .env.example 为显式 ZeroTier 模板

**Files:**
- Modify: `.env.example`
- Modify: `backend/tests/test_start_scripts.py`

**Interfaces:**
- Consumes: runtime `SERVER_HOST`, `SERVER_PORT`, FastAPI CORS/TrustedHost settings。
- Produces: documented placeholder values that cannot be mistaken for a usable default；no AI/TLS/public deployment variables。

- [ ] **Step 1: 写模板失败测试**

Add:

```python
def test_env_example_documents_explicit_zerotier_binding_without_tls_or_ai():
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    assert "SERVER_HOST=REPLACE_WITH_ZEROTIER_IPV4" in text
    assert "SERVER_PORT=8720" in text
    assert "CORS_ORIGINS=http://REPLACE_WITH_ZEROTIER_IPV4:8720" in text
    assert "ALLOWED_HOSTS=REPLACE_WITH_ZEROTIER_IPV4,localhost,127.0.0.1" in text
    for forbidden in ("0.0.0.0", "LLM_", "EMBEDDING_", "TLS", "TUNNEL_TOKEN"):
        assert forbidden not in text
```

- [ ] **Step 2: 运行测试并确认模板尚未满足**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_start_scripts.py::test_env_example_documents_explicit_zerotier_binding_without_tls_or_ai -q
```

Expected: FAIL on missing `SERVER_HOST`。

- [ ] **Step 3: 重写绑定与安全配置段**

Use exactly:

```env
# Required: replace with an IPv4 currently assigned to this machine's ZeroTier adapter.
# Startup fails if the address is missing, invalid, loopback, all-interfaces, LAN-only,
# or not owned by a verified ZeroTier interface.
SERVER_HOST=REPLACE_WITH_ZEROTIER_IPV4
SERVER_PORT=8720

# Same-origin browser access over the configured ZeroTier address.
CORS_ORIGINS=http://REPLACE_WITH_ZEROTIER_IPV4:8720
ALLOWED_HOSTS=REPLACE_WITH_ZEROTIER_IPV4,localhost,127.0.0.1

MAX_EPUB_UPLOAD_MB=90

# Obsidian export vault path (optional)
# OBSIDIAN_VAULT_PATH=C:\Users\Family\Documents\ObsidianVault
```

Do not insert a real address and do not create `.env`。

- [ ] **Step 4: 运行模板与 runtime tests**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests/test_start_scripts.py backend/tests/test_runtime.py backend/tests/test_config.py -q
```

Expected: all selected tests PASS。

- [ ] **Step 5: Commit**

```bash
git add .env.example backend/tests/test_start_scripts.py
git commit -m "Document explicit ZeroTier server binding"
```

---

## Final Verification: 全量自动测试与真实 ZeroTier binding 验收

**Files:**
- Verify: `backend/runtime.py`
- Verify: `backend/main.py`
- Verify: `start.bat`
- Verify: `start.sh`
- Verify: `.env.example`
- No tracked files modified in this task

**Interfaces:**
- Consumes: a test host actually joined to ZeroTier and a user-configured local `.env`（not committed）。
- Produces: proof that the listener is only on the configured ZeroTier endpoint；remote reader/sync evidence；separate Service Worker secure-context result。

- [ ] **Step 1: 运行完整后端测试**

Run:

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,testserver" CORS_ORIGINS="http://testserver" .venv/Scripts/python.exe -m pytest backend/tests -q
```

Expected: all collected tests PASS。

- [ ] **Step 2: 运行完整前端测试**

Run:

```bash
cd frontend && npx playwright test
```

Expected: all collected tests PASS。

- [ ] **Step 3: 使用用户已经配置的本地 .env 运行 validator，但不显示文件内容**

Run:

```powershell
& .\.venv\Scripts\python.exe .\backend\runtime.py validate --format json
```

Expected: JSON includes exactly one configured `host`, configured `port`, and `http://host:port`；failure must list verified ZeroTier IPv4 choices but not auto-select one。Do not use `Get-Content .env`。

- [ ] **Step 4: 启动服务并检查监听地址**

Run `start.bat`, then in another PowerShell:

```powershell
$binding = & .\.venv\Scripts\python.exe .\backend\runtime.py validate --format json | ConvertFrom-Json
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $binding.port)
if (-not ($listeners | Where-Object LocalAddress -eq $binding.host)) { throw "Configured ZeroTier listener missing" }
if ($listeners | Where-Object LocalAddress -in @("0.0.0.0", "127.0.0.1", "::", "::1")) { throw "Unsafe fallback listener found" }
$listeners | Select-Object LocalAddress,LocalPort,OwningProcess
```

Expected: listener exists only for configured ZeroTier IPv4/port；no all-interface or loopback listener。

- [ ] **Step 5: 验证普通 LAN 地址不可访问**

On the server, identify a non-ZeroTier Wi-Fi/Ethernet IPv4 via adapter name, not by prefix. From another LAN device run:

```bash
curl --connect-timeout 5 -v http://ORDINARY_LAN_IPV4:CONFIGURED_SERVER_PORT/health
```

Expected: connection fails。Do not add a portproxy or firewall fallback to make it succeed。

- [ ] **Step 6: 从同一 ZeroTier 网络远端设备验收阅读与同步**

Open `http://CONFIGURED_ZEROTIER_IPV4:CONFIGURED_SERVER_PORT/` on another ZeroTier member device。Execute exactly:

1. Upload `multichapter.epub` or another disposable EPUB through `/api/books/upload` UI。
2. Open it in the main reader；move progress；create one bookmark、one highlight、one note。
3. Open `/book-chat/`；verify server library loads、book opens、TOC navigation works、full-text search finds a known fixture word。
4. On a second browser profile/device, reopen the book and confirm progress/bookmark/highlight/note synchronize through protocol v2。

Expected: all reading and synchronization behaviors pass over HTTP ZeroTier IP。This is the remote product acceptance and does not depend on Service Worker registration。

- [ ] **Step 7: 单独记录浏览器 secure-context / Service Worker 结果**

In the remote browser console on `http://CONFIGURED_ZEROTIER_IPV4:CONFIGURED_SERVER_PORT/`, evaluate:

```js
({
  isSecureContext: window.isSecureContext,
  hasServiceWorkerApi: 'serviceWorker' in navigator,
  controller: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
})
```

Expected for a typical raw HTTP ZeroTier IP: `isSecureContext: false`, Service Worker API unavailable or no controller。Record this as an expected platform limitation, not a reading/sync failure。Do not add TLS in response。Separately verify Service Worker behavior on a browser-recognized secure context such as Playwright's loopback HTTP fixture (`http://127.0.0.1`) or a later explicitly approved HTTPS project。

- [ ] **Step 8: 验证防火墙规则范围并禁止公网转发**

Run:

```powershell
$binding = & .\.venv\Scripts\python.exe .\backend\runtime.py validate --format json | ConvertFrom-Json
Get-NetFirewallRule -Enabled True | Get-NetFirewallPortFilter | Where-Object LocalPort -eq $binding.port
```

Expected: any allow rule is scoped to the configured port and ZeroTier adapter/address/profile according to local policy；there is no router/public port forwarding。If no rule exists and remote Step 6 fails, create a narrowly scoped Windows Firewall rule manually during operations execution, never a broad `Any` interface rule。

- [ ] **Step 9: 检查工作树与提交序列**

Run:

```bash
git status --short
git log --oneline -10
```

Expected: no `.env` or runtime data is tracked；Tasks 2-10 are separate reviewable commits。下一步严格执行 `docs/superpowers/plans/2026-09-23-local-operations-cleanup.md`。
