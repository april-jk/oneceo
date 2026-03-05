const fs = require('fs');
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:4000/ws/task-creation');
const logPath = 'D:/project/oneceo.ai/ws-e2e-log4.json';
const log = [];
let sessionId = null;
let done = false;

function record(entry) {
  log.push({ ts: new Date().toISOString(), ...entry });
  if (log.length % 20 === 0) {
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  }
}

const timeout = setTimeout(() => {
  record({ event: 'timeout' });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log('timeout');
  process.exit(1);
}, 720000);

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'user_input',
    content: '创建2048小游戏，html即可'
  }));
  record({ event: 'sent_user_input' });
});

ws.on('message', (data) => {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (e) {
    record({ event: 'parse_error', error: String(e) });
    return;
  }
  if (msg.sessionId) sessionId = msg.sessionId;
  record({ event: 'message', type: msg.type, content: msg.content, metadata: msg.metadata, sessionId: msg.sessionId });

  if (msg.type === 'clarification_request') {
    ws.send(JSON.stringify({ type: 'user_response', content: '请直接生成单文件 HTML 版本 2048 游戏' }));
    record({ event: 'sent_user_response' });
  }

  if (msg.type === 'status_update' && typeof msg.content === 'string') {
    if (msg.content.includes('交付阶段') || msg.content.includes('执行完成') || msg.content.includes('完成')) {
      done = true;
    }
  }

  if (done) {
    clearTimeout(timeout);
    setTimeout(() => {
      record({ event: 'done', sessionId });
      fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
      console.log('done', sessionId);
      process.exit(0);
    }, 2000);
  }
});

ws.on('error', (err) => {
  record({ event: 'ws_error', error: String(err) });
});

ws.on('close', () => {
  record({ event: 'ws_close' });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
});
