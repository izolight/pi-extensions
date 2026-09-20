import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

import type { GuardClient, GuardDecision, GuardRequest } from "./laya-guardrails.ts";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export class LayaSocketClient implements GuardClient {
  private readonly socketPath: string;
  private readonly timeoutMs: number;

  constructor(socketPath: string, timeoutMs = 2_000) {
    this.socketPath = socketPath;
    this.timeoutMs = timeoutMs;
  }

  classify(request: GuardRequest): Promise<GuardDecision> {
    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let response = "";
      let settled = false;

      const finish = (error?: Error, decision?: GuardDecision) => {
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
          if (parsed.verdict !== "allow" && parsed.verdict !== "deny") {
            throw new Error("Laya socket returned an invalid verdict");
          }
          if (!Array.isArray(parsed.reasons) || !parsed.reasons.every((reason: unknown) => typeof reason === "string")) {
            throw new Error("Laya socket returned invalid reasons");
          }
          if (parsed.warnings !== undefined && (
            !Array.isArray(parsed.warnings)
            || !parsed.warnings.every((warning: unknown) => typeof warning === "string")
          )) {
            throw new Error("Laya socket returned invalid warnings");
          }
          if (parsed.scores !== undefined && (
            parsed.scores === null
            || typeof parsed.scores !== "object"
            || Array.isArray(parsed.scores)
            || !Object.values(parsed.scores).every((score) => typeof score === "number" && Number.isFinite(score))
          )) {
            throw new Error("Laya socket returned invalid scores");
          }
          const decision: GuardDecision = { verdict: parsed.verdict, reasons: parsed.reasons };
          if (parsed.scores !== undefined) decision.scores = parsed.scores;
          if (parsed.warnings !== undefined) decision.warnings = parsed.warnings;
          finish(undefined, decision);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.on("end", () => {
        if (!settled) finish(new Error("Laya socket closed before returning a decision"));
      });
    });
  }
}
