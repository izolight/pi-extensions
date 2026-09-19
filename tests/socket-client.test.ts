import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { LayaSocketClient } from "../extensions/laya-socket-client.ts";

test("socket client exchanges one newline-delimited guard decision", async (t) => {
  const socketPath = join(tmpdir(), `pi-laya-test-${process.pid}-${Date.now()}.sock`);
  const server = createServer((socket) => {
    let request = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      request += chunk;
      if (!request.includes("\n")) return;
      const parsed = JSON.parse(request.slice(0, request.indexOf("\n")));
      socket.end(`${JSON.stringify({ id: parsed.id, verdict: "deny", reasons: ["unsafe"] })}\n`);
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(() => server.close());

  const client = new LayaSocketClient(socketPath, 500);
  const result = await client.classify({ kind: "input", text: "bad prompt" });

  assert.deepEqual(result, { verdict: "deny", reasons: ["unsafe"] });
});

test("socket client rejects malformed warning data", async (t) => {
  const socketPath = join(tmpdir(), `pi-laya-test-${process.pid}-${Date.now()}-bad.sock`);
  const server = createServer((socket) => {
    let request = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      request += chunk;
      if (!request.includes("\n")) return;
      const parsed = JSON.parse(request.slice(0, request.indexOf("\n")));
      socket.end(`${JSON.stringify({ id: parsed.id, verdict: "allow", reasons: [], warnings: "bad" })}\n`);
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(() => server.close());

  const client = new LayaSocketClient(socketPath, 500);

  await assert.rejects(
    client.classify({ kind: "input", text: "hello" }),
    /invalid warnings/,
  );
});
