import WebSocket from 'ws';

const url = 'ws://127.0.0.1:4000/ws/task-creation';
const ws = new WebSocket(url);
const startedAt = Date.now();
const timeoutMs = 240_000;
let sent = false;
let repliedClarify = false;
let gotOpencodeEvent = false;
let gotPromptAcceptedText = false;
let sessionId: string | null = null;

function done(code: number) {
  try { ws.close(); } catch {}
  process.exit(code);
}

const timer = setTimeout(() => {
  console.error('timeout reached, opencode_event=', gotOpencodeEvent, 'acceptedText=', gotPromptAcceptedText, 'sessionId=', sessionId);
  done(2);
}, timeoutMs);

ws.on('open', () => {
  console.log('[open]', url);
});

ws.on('message', (buf) => {
  const raw = buf.toString();
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.log('[raw]', raw);
    return;
  }

  if (msg.sessionId && !sessionId) {
    sessionId = String(msg.sessionId);
  }

  const type = String(msg.type || '');
  const content = String(msg.content || msg.message || msg.question || '').slice(0, 200);
  console.log('[msg]', type, content);

  if (!sent && type === 'agent_message') {
    const input = '请在当前工作区创建一个单文件 HTML 贪吃蛇游戏，文件名 snake.html，并说明运行方式。';
    ws.send(JSON.stringify({ type: 'user_input', content: input }));
    sent = true;
    console.log('[send] user_input');
    return;
  }

  if (type === 'clarification_request' && !repliedClarify) {
    ws.send(JSON.stringify({ type: 'user_response', content: '直接生成可运行的完整代码即可。', sessionId: sessionId || undefined }));
    repliedClarify = true;
    console.log('[send] user_response');
    return;
  }

  if (type === 'agent_message' && /执行指令已提交到 OSAC|任务已发送到 OpenCode/i.test(content)) {
    gotPromptAcceptedText = true;
  }

  if (type === 'opencode_event') {
    gotOpencodeEvent = true;
  }

  if (gotOpencodeEvent) {
    console.log('[success] got opencode_event, sessionId=', sessionId, 'elapsedMs=', Date.now() - startedAt);
    clearTimeout(timer);
    done(0);
  }

  if (type === 'error') {
    console.error('[error-msg]', content);
  }
});

ws.on('close', () => {
  console.log('[close]');
});

ws.on('error', (err) => {
  console.error('[ws-error]', err);
  clearTimeout(timer);
  done(1);
});
