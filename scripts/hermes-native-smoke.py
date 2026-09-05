#!/usr/bin/env python3
"""Exercise Boomkin's native Hermes contract without a model, auth, or wallet.

Run with an isolated upstream Hermes install:
  python3 scripts/hermes-native-smoke.py --hermes /tmp/hermes-venv/bin/hermes
Add --public to test only the keyless CoinGecko MCP handshake/tool discovery.
The default run uses a local mock MCP and makes no provider calls.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--hermes", required=True)
parser.add_argument("--public", action="store_true")
args = parser.parse_args()
hermes = Path(args.hermes).absolute()
python = hermes.parent / "python"
repo = Path(__file__).resolve().parents[1]
bun = shutil.which("bun")
if not bun or not python.is_file():
    raise SystemExit("Require Bun and a Hermes virtual environment containing bin/python")

with tempfile.TemporaryDirectory(prefix="boomkin-native-smoke-") as temporary:
    root = Path(temporary).resolve()
    env = {key: value for key, value in os.environ.items() if key in {"PATH", "LANG", "TMPDIR", "SHELL"}}
    env.update(HERMES_HOME=str(root), HERMES_CONFIG=str(root / "config.yaml"), HERMES_ENV=str(root / ".env"), NO_COLOR="1", BOOMKIN_SMOKE_ROOT=str(root))

    def run(command, cwd=root):
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise AssertionError(f"Smoke command failed: {command[0]} (exit {result.returncode})")
        return result.stdout

    run([bun, "-e", '''import { initializeProfile, configureMcpServers } from "./src/hermes.ts";
import { coinGeckoConfig, aixbtConfig } from "./src/onboarding.ts";
await initializeProfile(process.env.BOOMKIN_SMOKE_ROOT!, "# Boomkin smoke identity\\n");
await configureMcpServers(process.env.BOOMKIN_SMOKE_ROOT!, { coingecko: { ...coinGeckoConfig, enabled: false }, aixbt: { ...aixbtConfig, enabled: false } });'''], cwd=repo)
    version = run([str(hermes), "--profile", "default", "--version"])
    assert "Hermes Agent v" in version
    assert run([str(hermes), "--profile", "default", "config", "path"]).strip() == str(root / "config.yaml")
    cfg = json.loads(run([str(hermes), "--profile", "default", "config", "get", "mcp_servers.coingecko", "--json"]))
    assert cfg["tools"]["include"] == ["execute", "search_docs"]
    assert cfg["trust"] == "untrusted"
    assert "--non-interactive" in run([str(hermes), "--profile", "default", "setup", "--help"])
    assert "interactive wizard cannot" in run([str(hermes), "--profile", "default", "setup", "--non-interactive"])

    # Direct native loader/filter contracts, without agent/model initialization.
    run([str(python), "-c", '''
from hermes_constants import get_hermes_home
from agent.prompt_builder import load_soul_md
from tools.mcp_tool_registration import _make_tool_filter
from tools.mcp_tool_config import _interpolate_env_vars
import os
assert str(get_hermes_home()) == os.environ['HERMES_HOME']
assert 'Boomkin smoke identity' in load_soul_md()
f = _make_tool_filter('smoke', {'tools': {'include': ['read_price'], 'exclude': ['read_price']}})
assert f('read_price') and not f('send_transaction')
assert not _make_tool_filter('smoke', {'tools': {'include': []}})('read_price')
from hermes_cli.config import load_config
cfg = load_config()['mcp_servers']['aixbt']
assert cfg['enabled'] is False
assert cfg['url'] == 'https://api.aixbt.tech/mcp'
assert cfg['headers']['Authorization'] == 'Bearer ${AIXBT_API_KEY}'
os.environ['AIXBT_API_KEY'] = 'isolated-native-fixture'
assert _interpolate_env_vars(cfg)['headers']['Authorization'] == 'Bearer isolated-native-fixture'
aixbt_filter = _make_tool_filter('aixbt', cfg)
assert aixbt_filter('list_topics') and aixbt_filter('me')
assert not aixbt_filter('unreviewed_future_tool') and not aixbt_filter('send_transaction')
'''])
    # Minimal stdio MCP: schema discovery only; a tools/call request fails this smoke.
    mock = root / "mock_mcp.py"
    mock.write_text('''import json, sys
for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request:
        continue
    method = request.get('method')
    if method == 'initialize':
        result = {'protocolVersion': request['params']['protocolVersion'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'boomkin-smoke', 'version': '1.0.0'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'read_price', 'description': 'Mock read only', 'inputSchema': {'type': 'object', 'properties': {}}, 'annotations': {'readOnlyHint': True}}]}
    elif method == 'ping':
        result = {}
    else:
        raise SystemExit('Unexpected method in schema-only smoke')
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
''')
    env["BOOMKIN_SMOKE_PYTHON"] = str(python)
    env["BOOMKIN_SMOKE_MOCK"] = str(mock)
    run([bun, "-e", '''import { configureMcpServers } from "./src/hermes.ts";
await configureMcpServers(process.env.BOOMKIN_SMOKE_ROOT!, { local_smoke: { command: process.env.BOOMKIN_SMOKE_PYTHON!, args: [process.env.BOOMKIN_SMOKE_MOCK!], protocol: "legacy", trust: "untrusted", tools: {include:["read_price"],resources:false,prompts:false} } });'''], cwd=repo)
    output = run([str(hermes), "--profile", "default", "mcp", "test", "local_smoke"])
    assert "Connected" in output and "Tools discovered: 1" in output and "read_price" in output, "Native mock MCP did not positively connect"
    public_verified = False
    if args.public:
        # Native mcp test probes even a disabled entry. Only keyless discovery is used.
        output = run([str(hermes), "--profile", "default", "mcp", "test", "coingecko"])
        assert "Connected" in output and "Tools discovered: 2" in output and "execute" in output and "search_docs" in output, "Public native MCP contract did not positively verify"
        public_verified = True
    print(json.dumps({"runtime": version.splitlines()[0], "profile_isolation": "passed", "soul": "passed", "config": "passed", "native_tool_filters": "passed", "aixbt_environment_and_filters": "passed", "local_mcp_discovery": "passed", "public_coingecko_discovery": "passed" if public_verified else "not-requested", "model_auth_wallet_calls": "none"}))
