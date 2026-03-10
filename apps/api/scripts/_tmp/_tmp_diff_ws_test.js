const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:4000/ws/task-creation");
let sessionId = null;
let diffCount = null;
let done = false;

const timeout = setTimeout(() => {
  console.log("timeout");
  process.exit(1);
}, 240000);

function send(message) {
  ws.send(JSON.stringify(message));
}

ws.on("open", () => {
  send({
    type: "user_input",
    content: "请在工作区创建目录 diff_test，并创建 diff_test/hello.txt，内容为 hello"
  });
});

ws.on("message", (data) => {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (e) {
    console.log("parse error", e);
    return;
  }

  if (msg.sessionId) sessionId = msg.sessionId;

  if (msg.type === "clarification_request") {
    send({ type: "user_response", content: "直接在当前工作区创建文件即可" });
  }

  if (msg.type === "opencode_event") {
    const meta = msg.metadata || {};
    const eventType = meta.eventType || meta.event?.type || meta.rawPayload?.eventType || meta.rawPayload?.event?.type;
    if (eventType === "session.diff") {
      const diff = meta.event?.properties?.diff || meta.rawPayload?.event?.properties?.diff || meta.rawPayload?.diff;
      if (Array.isArray(diff)) {
        diffCount = diff.length;
        console.log("session.diff length", diff.length);
      } else {
        console.log("session.diff payload", diff);
      }
    }
  }

  if (msg.type === "status_update" && typeof msg.content === "string" && msg.content.includes("OpenCode 执行完成")) {
    done = true;
  }

  if (done) {
    clearTimeout(timeout);
    setTimeout(() => {
      console.log("done", { sessionId, diffCount });
      process.exit(0);
    }, 2000);
  }
});
