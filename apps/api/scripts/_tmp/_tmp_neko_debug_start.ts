import '../src/config/env';
import { e2bConnector } from '../src/connectors/e2b-connector';

const sandboxId = process.env.SANDBOX_ID || 'izq6qwmslxdx47exe5okl';
const nekoPort = process.env.NEKO_PORT || '8080';
const cdpPort = process.env.NEKO_CDP_PORT || '9222';
const display = process.env.NEKO_DISPLAY || ':0';

const startCommand = `
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

ROOTCMD=""
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    ROOTCMD="sudo -n"
  fi
fi

$ROOTCMD mkdir -p /opt/neko
cat <<EOF | $ROOTCMD tee /opt/neko/neko.yml >/dev/null
server:
  bind: "0.0.0.0:${nekoPort}"
  static: "/tmp/neko-src/client/dist"
capture:
  display: "${display}"
  video_codec: "h264"
  video_bitrate: 3000
webrtc:
  ice_servers:
    - urls: ["stun:stun.l.google.com:19302"]
  epr: 51000-51100
desktop:
  input:
    enabled: false
member:
  provider: "noauth"
session:
  cookie:
    enabled: false
    secure: false
EOF

if ! pgrep -x Xvfb >/dev/null 2>&1; then
  nohup Xvfb ${display} -screen 0 1280x720x24 -nolisten tcp > /tmp/xvfb.log 2>&1 &
fi

export DISPLAY=${display}
for i in $(seq 1 10); do
  if [ -S /tmp/.X11-unix/X0 ]; then
    break
  fi
  sleep 0.5
done

if ! pgrep -x chromium >/dev/null 2>&1 && ! pgrep -x chromium-browser >/dev/null 2>&1; then
  if command -v chromium-browser >/dev/null 2>&1; then
    CHROME_BIN=$(command -v chromium-browser)
  else
    CHROME_BIN=$(command -v chromium)
  fi
  nohup "$CHROME_BIN" \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --remote-debugging-port=${cdpPort} \
    --user-data-dir=/tmp/chromium-profile \
    --window-size=1280,720 \
    about:blank \
    > /tmp/chromium.log 2>&1 &
fi

if pgrep -x neko >/dev/null 2>&1; then
  pkill -x neko || true
  sleep 1
fi
nohup neko serve --config /opt/neko/neko.yml > /tmp/neko.log 2>&1 &
`;

async function main() {
  console.log(`Starting neko in sandbox ${sandboxId}`);
  const result = await e2bConnector.runCommand(sandboxId, startCommand, { timeoutMs: 120000 });
  if (result?.stdout) console.log(result.stdout);
  if (result?.stderr) console.error(result.stderr);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
