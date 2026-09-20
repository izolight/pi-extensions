import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { LayaRouterSocketClient } from "./laya-socket-client.ts";

export const ROUTE_LEVELS = ["low", "medium", "high"] as const;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type RouteLevel = (typeof ROUTE_LEVELS)[number];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ModelTarget {
  provider: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
}

export interface RouterConfig {
  levels: Partial<Record<RouteLevel, ModelTarget>>;
}

export interface RouteRequest {
  kind: "model_route";
  text: string;
}

export interface RouteDecision {
  level: RouteLevel;
  confidence?: number;
}

export interface RouterClient {
  route(request: RouteRequest): Promise<RouteDecision>;
}

export interface ModelRouterOptions extends RouterClient {
  config: RouterConfig;
}

function isRouteLevel(value: unknown): value is RouteLevel {
  return typeof value === "string" && ROUTE_LEVELS.includes(value as RouteLevel);
}

function parseConfig(path: string): RouterConfig {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { levels?: Record<string, unknown> };
  if (!parsed.levels || typeof parsed.levels !== "object" || Array.isArray(parsed.levels)) {
    throw new Error(`Router config ${path} must contain a levels object`);
  }

  const levels: RouterConfig["levels"] = {};
  for (const [level, rawTarget] of Object.entries(parsed.levels)) {
    if (!isRouteLevel(level)) throw new Error(`Unknown router level "${level}" in ${path}`);
    if (!rawTarget || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
      throw new Error(`Router level "${level}" in ${path} must be an object`);
    }
    const target = rawTarget as Record<string, unknown>;
    if (typeof target.provider !== "string" || typeof target.model !== "string") {
      throw new Error(`Router level "${level}" in ${path} requires provider and model strings`);
    }
    if (target.thinkingLevel !== undefined && !THINKING_LEVELS.includes(target.thinkingLevel as ThinkingLevel)) {
      throw new Error(`Router level "${level}" in ${path} has an invalid thinkingLevel`);
    }
    levels[level] = {
      provider: target.provider,
      model: target.model,
      ...(target.thinkingLevel !== undefined ? { thinkingLevel: target.thinkingLevel as ThinkingLevel } : {}),
    };
  }
  return { levels };
}

export function loadRouterConfig(
  cwd: string,
  projectTrusted: boolean,
  agentDir: string,
  configDirName: string,
): RouterConfig {
  const paths = [join(agentDir, "laya-model-router.json")];
  if (projectTrusted) paths.push(join(cwd, configDirName, "laya-model-router.json"));

  const levels: RouterConfig["levels"] = {};
  for (const path of paths) {
    if (existsSync(path)) Object.assign(levels, parseConfig(path).levels);
  }
  return { levels };
}

function targetLabel(target: ModelTarget): string {
  const thinking = target.thinkingLevel ? ` (thinking: ${target.thinkingLevel})` : "";
  return `${target.provider}/${target.model}${thinking}`;
}

export function createLayaModelRouter(options: ModelRouterOptions) {
  return function register(pi: ExtensionAPI): void {
    let lastRoute: { level: RouteLevel; target: ModelTarget } | undefined;

    function updateStatus(ctx: ExtensionContext): void {
      ctx.ui.setStatus(
        "laya-model-router",
        lastRoute ? `route:${lastRoute.level} → ${lastRoute.target.model}` : undefined,
      );
    }

    pi.registerCommand("laya-router", {
      description: "Show Laya model-router levels and mappings",
      handler: async (_args, ctx) => {
        const mappings = ROUTE_LEVELS.map((level) => {
          const target = options.config.levels[level];
          return `${level}: ${target ? targetLabel(target) : "unmapped"}`;
        });
        ctx.ui.notify(`Laya model router\n${mappings.join("\n")}`, "info");
      },
    });

    pi.on("before_agent_start", async (event, ctx) => {
      if (Object.keys(options.config.levels).length === 0) return;

      let decision: RouteDecision;
      try {
        decision = await options.route({ kind: "model_route", text: event.prompt });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Laya model router unavailable; keeping current model: ${message}`, "warning");
        return;
      }

      const target = options.config.levels[decision.level];
      if (!target) {
        ctx.ui.notify(`Laya selected unmapped level "${decision.level}"; keeping current model`, "warning");
        return;
      }

      const model = ctx.modelRegistry.find(target.provider, target.model);
      if (!model) {
        ctx.ui.notify(`Laya route target not found: ${targetLabel(target)}`, "warning");
        return;
      }
      if (!(await pi.setModel(model))) {
        ctx.ui.notify(`Laya route target has no configured authentication: ${targetLabel(target)}`, "warning");
        return;
      }

      if (target.thinkingLevel) pi.setThinkingLevel(target.thinkingLevel);
      lastRoute = { level: decision.level, target };
      updateStatus(ctx);
    });

    pi.on("session_start", async (_event, ctx) => updateStatus(ctx));
  };
}

export default async function layaModelRouter(pi: ExtensionAPI): Promise<void> {
  const { CONFIG_DIR_NAME, getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const socketPath = process.env.PI_LAYA_SOCKET ?? "/tmp/pi-laya-guardrails.sock";
  const configuredTimeout = Number(process.env.PI_LAYA_TIMEOUT_MS ?? "2000");
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 2_000;
  let config: RouterConfig;

  pi.on("session_start", async (_event, ctx) => {
    try {
      config = loadRouterConfig(ctx.cwd, ctx.isProjectTrusted(), getAgentDir(), CONFIG_DIR_NAME);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Could not load Laya model-router config: ${message}`, "error");
      config = { levels: {} };
    }
  });

  const client = new LayaRouterSocketClient(socketPath, timeoutMs);
  createLayaModelRouter({
    get config() { return config ?? { levels: {} }; },
    route: (request) => client.route(request),
  })(pi);
}
