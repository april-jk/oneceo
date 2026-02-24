const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:4000/ws/task-creation");
const send = (payload) => ws.send(JSON.stringify(payload));

const timer = setTimeout(() => {
  console.log("timeout waiting for session.diff");
  process.exit(1);
}, 120000);

ws.on("open", () => {
  console.log("ws open");
  send({ type: "user_input", content: "请在工作区创建目录 diff_test，并创建 diff_test/hello.txt，内容为 hello" });
});

ws.on("message", (data) => {
  const text = data.toString();
  try {
    const msg = JSON.parse(text);
    if (msg.type === "opencode_event") {
      const evt = msg.metadata?.event;
      if (evt?.type) {
        console.log("event", evt.type);
      }
      if (evt?.type === "session.diff") {
        const diff = evt?.properties?.diff;
        console.log("session.diff", Array.isArray(diff) ? diff.length : diff);
        if (Array.isArray(diff)) {
          const files = diff.map((d) => d.file).join(", ");
          console.log("files", files);
        }
        clearTimeout(timer);
        process.exit(0);
      }
    }
  } catch (err) {
    // ignore
  }
});

ws.on("close", () => console.log("ws closed"));
ws.on("error", (err) => {
  console.error("ws error", err?.message || err);
  clearTimeout(timer);
  process.exit(1);
});
