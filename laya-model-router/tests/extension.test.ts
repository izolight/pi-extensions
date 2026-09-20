import assert from "node:assert/strict";
import test from "node:test";

import { createLayaModelRouter } from "../extensions/laya-model-router.ts";

type Handler = (event: any, ctx: any) => Promise<any>;

function piHarness() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, any>();
  const selected: any[] = [];
  const thinking: string[] = [];
  const pi = {
    on(name: string, handler: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    async setModel(model: any) { selected.push(model); return true; },
    setThinkingLevel(level: string) { thinking.push(level); },
  };
  return { pi, handlers, commands, selected, thinking };
}

function context(models: Record<string, any> = {}) {
  const notices: string[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  return {
    notices,
    statuses,
    ctx: {
      ui: {
        notify: (message: string) => notices.push(message),
        setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      },
      modelRegistry: {
        find: (provider: string, model: string) => models[`${provider}/${model}`],
      },
    },
  };
}

test("routes a high-strength task to the user-mapped model", async () => {
  const harness = piHarness();
  const target = { provider: "anthropic", id: "claude-opus" };
  createLayaModelRouter({
    config: { levels: { high: { provider: "anthropic", model: "claude-opus", thinkingLevel: "high" } } },
    route: async () => ({ level: "high", confidence: 0.92 }),
  })(harness.pi as any);
  const { ctx, statuses } = context({ "anthropic/claude-opus": target });

  await harness.handlers.get("before_agent_start")![0]({ prompt: "Design a distributed database" }, ctx);

  assert.deepEqual(harness.selected, [target]);
  assert.deepEqual(harness.thinking, ["high"]);
  assert.deepEqual(statuses.at(-1), ["laya-model-router", "route:high → claude-opus"]);
});

test("keeps the current model when Laya selects an unmapped level", async () => {
  const harness = piHarness();
  createLayaModelRouter({
    config: { levels: { low: { provider: "test", model: "small" } } },
    route: async () => ({ level: "high" }),
  })(harness.pi as any);
  const { ctx, notices } = context();

  await harness.handlers.get("before_agent_start")![0]({ prompt: "Hard task" }, ctx);

  assert.deepEqual(harness.selected, []);
  assert.match(notices[0], /unmapped level "high"/);
});

test("keeps the current model when routing is unavailable", async () => {
  const harness = piHarness();
  createLayaModelRouter({
    config: { levels: { low: { provider: "test", model: "small" } } },
    route: async () => { throw new Error("socket unavailable"); },
  })(harness.pi as any);
  const { ctx, notices } = context();

  await harness.handlers.get("before_agent_start")![0]({ prompt: "Easy task" }, ctx);

  assert.deepEqual(harness.selected, []);
  assert.match(notices[0], /keeping current model: socket unavailable/);
});

test("status command lists all predefined levels", async () => {
  const harness = piHarness();
  createLayaModelRouter({
    config: { levels: { low: { provider: "test", model: "small" } } },
    route: async () => ({ level: "low" }),
  })(harness.pi as any);
  const { ctx, notices } = context();

  await harness.commands.get("laya-router").handler("", ctx);

  assert.match(notices[0], /low: test\/small/);
  assert.match(notices[0], /medium: unmapped/);
  assert.match(notices[0], /high: unmapped/);
});
