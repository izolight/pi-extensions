import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

import { ROUTE_LEVELS, type RouteDecision, type RouteRequest, type RouterClient } from "./laya-model-router.ts";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export class LayaRouterSocketClient implements RouterClient {
  private readonly socketPath: string;
  private readonly timeoutMs: number;

  constructor(socketPath: string, timeoutMs = 2_000) {
    this.socketPath = socketPath;
    this.timeoutMs = timeoutMs;
  }

  route(request: RouteRequest): Promise<RouteDecision> {
    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let response = "";
      let settled = false;

      const finish = (error?: Error, decision?: RouteDecision) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(decision!);
      };

      socket.setEncoding("utf8");
      socket.setTimeout(this.timeoutMs, () => finish(new Error(`Laya socket timed out after ${this.timeoutMs}ms`)));
      socket.on("error", (error) => finish(error));
      socket.on("connect", () => socket.write(`${JSON.stringify({ id, ...request })}\n`));
      socket.on("data", (chunk) => {
        response += chunk;
        if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) {
          finish(new Error("Laya socket response exceeded 1MB"));
          return;
        }

        const newline = response.indexOf("\n");
        if (newline < 0) return;

        try {
          const parsed = JSON.parse(response.slice(0, newline));
          if (parsed.id !== id) throw new Error("Laya socket response id did not match request");
          if (typeof parsed.error === "string") throw new Error(`Laya server error: ${parsed.error}`);
          if (!ROUTE_LEVELS.includes(parsed.level)) throw new Error("Laya socket returned an invalid route level");
          if (parsed.confidence !== undefined && (
            typeof parsed.confidence !== "number"
            || !Number.isFinite(parsed.confidence)
            || parsed.confidence < 0
            || parsed.confidence > 1
          )) {
            throw new Error("Laya socket returned invalid route confidence");
          }
          finish(undefined, {
            level: parsed.level,
            ...(parsed.confidence !== undefined ? { confidence: parsed.confidence } : {}),
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.on("end", () => {
        if (!settled) finish(new Error("Laya socket closed before returning a route"));
      });
    });
  }
}
