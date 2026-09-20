import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { LayaSocketClient } from "./laya-socket-client.ts";

export type GuardMode = "confirm" | "enforce";

export interface GuardRequest {
  kind: "input" | "tool_call";
  text?: string;
  source?: string;
  toolName?: string;
  input?: unknown;
}

export interface GuardDecision {
  verdict: "allow" | "deny";
  reasons: string[];
  scores?: Record<string, number>;
  warnings?: string[];
}

export interface GuardClient {
  classify(request: GuardRequest): Promise<GuardDecision>;
}

export interface GuardrailsOptions extends GuardClient {
  mode?: GuardMode;
}

function explanation(decision: GuardDecision): string {
  return decision.reasons.length > 0 ? decision.reasons.join(", ") : "Laya classified the request as unsafe";
}

function promptPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? `${normalized.slice(0, 500)}…` : normalized;
}

export function createLayaGuardrails(options: GuardrailsOptions) {
  return function register(pi: ExtensionAPI): void {
    let mode: GuardMode = options.mode ?? "confirm";

    pi.registerCommand("laya-guardrails", {
      description: "Show or change the Laya guardrail mode (confirm|enforce)",
      handler: async (args, ctx) => {
        const requested = args.trim().toLowerCase();
        if (requested === "confirm" || requested === "enforce") mode = requested;
        else if (requested && requested !== "status") {
          ctx.ui.notify("Usage: /laya-guardrails [status|confirm|enforce]", "warning");
          return;
        }
        ctx.ui.notify(`Laya guardrail mode: ${mode}`, "info");
      },
    });

    pi.on("input", async (event, ctx) => {
      let decision: GuardDecision;
      try {
        decision = await options.classify({
          kind: "input",
          text: event.text,
          source: event.source,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Prompt blocked:\n\n${promptPreview(event.text)}\n\nReason: Laya guardrail unavailable: ${message}`,
          "error",
        );
        return { action: "handled" as const };
      }

      if (decision.verdict === "allow") {
        if (decision.warnings?.length) {
          ctx.ui.notify(`Laya warning: ${decision.warnings.join(", ")}`, "warning");
        }
        return { action: "continue" as const };
      }

      const reason = explanation(decision);
      const preview = promptPreview(event.text);
      if (mode === "confirm" && ctx.hasUI) {
        const choice = await ctx.ui.select(
          `Laya guardrail flagged this prompt:\n\n${preview}\n\nReason: ${reason}\n\nContinue?`,
          ["Allow", "Block"],
        );
        if (choice === "Allow") return { action: "continue" as const };
      }

      ctx.ui.notify(`Prompt blocked:\n\n${preview}\n\nReason: ${reason}`, "warning");
      return { action: "handled" as const };
    });

    pi.on("tool_call", async (event, ctx) => {
      let decision: GuardDecision;
      try {
        decision = await options.classify({
          kind: "tool_call",
          toolName: event.toolName,
          input: event.input,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const reason = `Laya guardrail unavailable: ${message}`;
        ctx.ui.notify(`${event.toolName} blocked: ${reason}`, "error");
        return { block: true, reason };
      }

      if (decision.verdict === "allow") return undefined;

      const reason = explanation(decision);
      if (mode === "confirm" && ctx.hasUI) {
        const choice = await ctx.ui.select(
          `Laya guardrail flagged ${event.toolName}:\n\n${reason}\n\nRun it anyway?`,
          ["Allow", "Block"],
        );
        if (choice === "Allow") return undefined;
      }

      ctx.ui.notify(`${event.toolName} blocked: ${reason}`, "warning");
      return { block: true, reason };
    });
  };
}

export default function layaGuardrails(pi: ExtensionAPI): void {
  const socketPath = process.env.PI_LAYA_SOCKET ?? "/tmp/pi-laya-guardrails.sock";
  const configuredTimeout = Number(process.env.PI_LAYA_TIMEOUT_MS ?? "2000");
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 2_000;
  const mode: GuardMode = process.env.PI_LAYA_GUARDRAILS_MODE === "enforce" ? "enforce" : "confirm";
  const client = new LayaSocketClient(socketPath, timeoutMs);
  createLayaGuardrails({ mode, classify: (request) => client.classify(request) })(pi);
}
