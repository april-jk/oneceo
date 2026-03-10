import { e2bConnector } from '../src/connectors/e2b-connector';

async function main() {
  const sandboxId = process.argv[2];
  if (!sandboxId) throw new Error('sandboxId required');
  const cmd = `
set -e
sudo -n tee /opt/neko/neko.yml >/dev/null <<'EOF'
server:
  bind: "0.0.0.0:8080"
  static: "/tmp/neko-src/client/dist"
capture:
  display: ":0"
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
EOF
pkill -f "neko serve" || true
nohup neko serve --config /opt/neko/neko.yml > /tmp/neko.log 2>&1 &
`;
  const result = await e2bConnector.runCommand(sandboxId, cmd, { timeoutMs: 60000 });
  console.log(result?.stdout || '');
  console.error(result?.stderr || '');
}

main().catch((error) => {
  console.error('[debug] failed', error);
  process.exit(1);
});
