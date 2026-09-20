import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LayaRouterSocketClient } from "../extensions/laya-socket-client.ts";

test("socket client exchanges one model-route decision", async (t) => {
  const socketPath = join(tmpdir(), `pi-laya-router-${process.pid}-${Date.now()}.sock`);
  const server = createServer((socket) => {
    let request = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      request += chunk;
      if (!request.includes("\n")) return;
      const parsed = JSON.parse(request.slice(0, request.indexOf("\n")));
      assert.equal(parsed.kind, "model_route");
      socket.end(`${JSON.stringify({ id: parsed.id, level: "medium", confidence: 0.81 })}\n`);
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(() => server.close());

  const client = new LayaRouterSocketClient(socketPath, 500);
  const result = await client.route({ kind: "model_route", text: "Refactor this module" });

  assert.deepEqual(result, { level: "medium", confidence: 0.81 });
});

test("socket client rejects an unknown route level", async (t) => {
  const socketPath = join(tmpdir(), `pi-laya-router-${process.pid}-${Date.now()}-bad.sock`);
  const server = createServer((socket) => {
    let request = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      request += chunk;
      if (!request.includes("\n")) return;
      const parsed = JSON.parse(request.slice(0, request.indexOf("\n")));
      socket.end(`${JSON.stringify({ id: parsed.id, level: "extreme" })}\n`);
    });
  });
  server.listen(socketPath);
  await once(server, "listening");
  t.after(() => server.close());

  const client = new LayaRouterSocketClient(socketPath, 500);
  await assert.rejects(client.route({ kind: "model_route", text: "hello" }), /invalid route level/);
});
