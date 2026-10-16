// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0
//
// Runs under `claude plugin test ./turn-receipt`. The test's hooks sit beneath
// the mod's: they stand for the engine, answering session.usage from a ledger
// the test moves, agent.spawn with a model and an id, and turn.complete with
// the answer as the engine would.

import type { On } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

const MODEL = "claude-haiku-4-5-20251001";
const START = { cwd: "/tmp", surface: "terminal" as const, isInteractive: true };
const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const END = { reason: "other" as const, sessionId: "s1", resume: { id: "s1" } };

// The local month NOW falls in, as the mod names it.
function monthOf(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const MONTH = monthOf(NOW);

const tok = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});

// A store the test can look into: the four store events answered from a Map,
// as mock.store would, but with the Map in the test's hands.
function memoryStore(on: On, entries: Record<string, unknown> = {}) {
  const map = new Map(Object.entries(entries));
  on("store.get", ($, e) => ({ value: map.get(e.key) }));
  on("store.set", ($, e) => {
    map.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("store.delete", ($, e) => {
    map.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...map.keys()] }));
  return map;
}

const run = (command: string, args = "") => ({
  command,
  args,
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: false, columns: 120 },
});

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0, model = MODEL) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model,
});

const turn = (answer: string, u?: ReturnType<typeof usage>, agentId?: string) => ({
  answer,
  durationMs: 1200,
  isAborted: false,
  turnId: "t1",
  reason: "answer" as const,
  ...(u ? { usage: u } : {}),
  ...(agentId ? { agentId } : {}),
});

const spawn = () => ({
  tool_use_id: "toolu_1",
  prompt: "look around",
  description: "explore",
  subagentType: "Explore",
  provider: { plugin: "engine", tier: "builtin" as const },
  parentModel: MODEL,
  background: false,
  fork: false,
});

let store = new Map<string, unknown>();

// The receipt the TurnDuration row draws for the turn just completed, as the
// markdown the mod hands the Markdown element, split into its list items with
// the list mark and the bold marks off; [] where the engine's own row stands.
async function drawn($: any, props = { word: "Baked", durationMs: 1200 }) {
  let ui;
  try {
    ui = await $.ui.mount({ plugin: "turn-receipt", surface: "terminal", component: "TurnDuration", props });
  } catch {
    // The mod drew nothing and the test has no engine row beneath it.
    return [];
  }
  const md = await ui.find({ type: "Markdown" });
  await ui.unmount();
  return plain(md?.text ?? md?.props?.text ?? "");
}

const plain = (markdown: string) =>
  markdown === "" ? [] : markdown.split("\n").map((l) => l.replace(/^- /, "").replaceAll("**", ""));

// Completes a turn, then draws its row; the receipt's lines.
async function complete($: any, t: ReturnType<typeof turn>) {
  await $.turn.complete(t);
  return drawn($);
}

function bottom(on: On, entries: Record<string, unknown> = {}) {
  store = memoryStore(on, entries);
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.end", ($, e) => ({ sessionId: e.sessionId }));
  on("session.id", () => ({ value: "s1" }));
  on("command.register", ($, e) => ({ value: { command: e.name } }));
  on("turn.complete", ($, e) => ({ text: e.answer, usage: e.usage }));
  on("agent.spawn", () => ({ model: MODEL, agentId: "agent-1" }));
  mock.clock(on, { now: NOW });
}

function ledger(on: On, state: { usd: number }, entries: Record<string, unknown> = {}) {
  bottom(on, entries);
  on("session.usage", () => ({
    value: {
      startedAt: 0,
      context: { tokens: 1000, window: 200_000, percent: 1 },
      rateLimits: [],
      cost: { usd: state.usd },
    },
  }));
}

function noLedger(on: On) {
  bottom(on);
  on("session.usage", () => ({
    value: {
      startedAt: 0,
      context: { tokens: 1000, window: 200_000, percent: 1 },
      rateLimits: [],
    },
  }));
}

test("draws the turn's tokens and cost, and the session, as markdown with bold numbers", async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.0431;
  const r = await $.turn.complete(turn("hello", usage(1200, 348, 98_300, 12_100)));
  expect(r.text).toBe("hello");

  const ui = await $.ui.mount({
    plugin: "turn-receipt",
    surface: "terminal",
    component: "TurnDuration",
    props: { word: "Baked", durationMs: 64_000 },
  });
  const md = await ui.find({ type: "Markdown" });
  expect(md?.text ?? md?.props?.text).toBe(
    [
      "- **receipt** · in **1.2k** · out **348** · cache read **98.3k** · cache write **12.1k** · **$0.043** · haiku-4-5-20251001",
      "- **session** · **1** turn · **111.9k** tokens · **$0.043**",
    ].join("\n"),
  );
  expect(await ui.find({ type: "Text", text: "Baked for 1m 4s" })).toBeDefined();
  await ui.unmount();
});

test("draws one line per section the options allow, and leaves the answer alone", async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.02;
  await $.agent.spawn(spawn());
  state.usd = 0.07;
  await $.turn.complete(turn("found", usage(500, 100), "agent-1"));
  state.usd = 0.08;
  const r = await $.turn.complete(turn("done", usage(200, 50)));

  expect(r.text).toBe("done");
  expect(await drawn($)).toEqual([
    "receipt · in 200 · out 50 · $0.030 · haiku-4-5-20251001",
    "agents · 1 run · in 500 · out 100 · $0.050 · turn total $0.080 · haiku-4-5-20251001",
    "session · 1 turn · 1 agent run · 850 tokens · $0.080",
  ]);
});

test("draws only the turn's line when the session and agents options are off", { options: { showSessionTotals: false, showSubAgentDetails: false } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.02;
  await $.agent.spawn(spawn());
  state.usd = 0.07;
  await $.turn.complete(turn("found", usage(500, 100), "agent-1"));
  state.usd = 0.08;
  await $.turn.complete(turn("done", usage(200, 50)));

  // The agents' dollars are folded into the turn's figure.
  expect(await drawn($)).toEqual(["receipt · in 200 · out 50 · $0.080 · haiku-4-5-20251001"]);
});

test("draws nothing for a turn that counted nothing", async ($, on) => {
  noLedger(on);
  await $.session.start(START);

  const r = await $.turn.complete(turn("interrupted"));
  expect(r.text).toBe("interrupted");
  expect(await drawn($)).toEqual([]);
});

test("draws a receipt for a turn without usage when allowEmptyReceipts is on", { options: { allowEmptyReceipts: true } }, async ($, on) => {
  noLedger(on);
  await $.session.start(START);

  await $.turn.complete(turn("interrupted"));
  expect(await drawn($)).toEqual([
    "receipt · in 0 · out 0 · cost n/a",
    "session · 1 turn · 0 tokens · cost n/a",
  ]);
});

test("draws nothing, but still tallies and saves, when renderReceiptAs is none", { options: { renderReceiptAs: "none", saveEveryNNTurns: 1 } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.01;
  const r = await $.turn.complete(turn("hi", usage(10, 5)));
  expect(r.text).toBe("hi");
  expect(await drawn($)).toEqual([]);

  state.usd = 0.02;
  await $.turn.complete(turn("again", usage(10, 5)));
  expect(store.get("session:s1")).toMatchObject({ turns: 2, usd: 0.02 });
  expect(store.get(`month:${MONTH}`)).toMatchObject({ sessions: 1, turns: 2, usd: 0.02 });
});

test("returns the receipt as one plain line of text when renderReceiptAs is text", { options: { renderReceiptAs: "text" } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.0431;
  const r = await $.turn.complete(turn("hello", usage(1200, 348, 98_300, 12_100)));

  expect(r.text).toBe(
    "receipt | in:1.2k | out:348 | cache read:98.3k | cache write:12.1k | $0.043 | haiku-4-5-20251001 // session | 1 turn | 111.9k tokens | $0.043",
  );
  expect(await drawn($)).toEqual([]);
});

// The band above the prompt on a surface, as the list items it draws.
async function band($: any, surface: "terminal" | "desktop") {
  let ui;
  try {
    ui = await $.ui.mount({
      plugin: "turn-receipt",
      surface,
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { bodyRows: 10, offset: 0, isFocused: false } },
    });
  } catch {
    // The mod stood down and the test has no engine band beneath it.
    return [];
  }
  const md = await ui.find({ type: "Markdown" });
  await ui.unmount();
  return plain(md?.text ?? md?.props?.text ?? "");
}

test("shows the latest receipt in the band above the prompt on the desktop, not on the terminal", async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  // Nothing yet: the band has nothing to show.
  expect(await band($, "desktop")).toEqual([]);

  state.usd = 0.02;
  await $.turn.complete(turn("one", usage(100, 50)));
  state.usd = 0.05;
  await $.turn.complete(turn("two", usage(200, 10)));

  const lines = await band($, "desktop");
  expect(lines[0]).toBe("receipt · in 200 · out 10 · $0.030 · haiku-4-5-20251001");
  expect(lines[1]).toBe("session · 2 turns · 360 tokens · $0.050");
  // The terminal has the TurnDuration row, so the band stands down there.
  expect(await band($, "terminal")).toEqual([]);
});

test("does not draw the band when renderReceiptAs is text or none", { options: { renderReceiptAs: "none" } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.02;
  await $.turn.complete(turn("one", usage(100, 50)));
  expect(await band($, "desktop")).toEqual([]);
});

test("keeps a model id that is not a claude- one, or is only the prefix, as it is", async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  expect((await complete($, turn("one", usage(1, 1, 0, 0, "gpt-x"))))[0]).toMatch(/· gpt-x$/);
  expect((await complete($, turn("two", usage(1, 1, 0, 0, "claude-"))))[0]).toMatch(/· claude-$/);
});

test("shows a model's name without the claude- prefix", async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  const lines = await complete($, turn("one", usage(10, 5, 0, 0, "claude-sonnet-5-5")));
  expect(lines[0]).toBe("receipt · in 10 · out 5 · $0.00 · sonnet-5-5");
});

test("charges each turn only the ledger's movement and keeps a session total", async ($, on) => {
  const state = { usd: 1.5 }; // a resumed session with earlier spend
  ledger(on, state);
  await $.session.start(START);

  state.usd = 1.52;
  const first = await complete($, turn("one", usage(100, 50)));
  expect(first[0]).toContain("$0.020");
  expect(first[1]).toBe("session · 1 turn · 150 tokens · $1.52");

  state.usd = 2.6;
  const second = await complete($, turn("two", usage(100, 50)));
  expect(second[0]).toContain("$1.08");
  expect(second[1]).toBe("session · 2 turns · 300 tokens · $2.60");
});

test("shows the turn alone when the session option is off", { options: { showSessionTotals: false } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.02;
  await $.turn.complete(turn("one", usage(100, 50)));
  state.usd = 0.05;
  const lines = await complete($, turn("two", usage(100, 50)));

  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("in 100");
  expect(lines[0]).toContain("$0.030");
  expect(lines.join("\n")).not.toContain("session");
});

test("splits a turn between the main loop and its subagents", async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  // The main loop spends 2 cents, then spawns a subagent.
  state.usd = 0.02;
  await $.agent.spawn(spawn());
  // The subagent runs twice, spending 5 cents in all.
  state.usd = 0.04;
  const run1 = await $.turn.complete(turn("found a", usage(500, 100, 0, 0, "claude-haiku-4-5-20251001"), "agent-1"));
  expect(run1.text).toBe("found a");
  state.usd = 0.07;
  await $.turn.complete(turn("found b", usage(500, 100), "agent-1"));
  // The main loop spends 1 more cent answering.
  state.usd = 0.08;
  const [receipt, agents, session, ...rest] = await complete($, turn("done", usage(200, 50)));

  expect(rest).toEqual([]);
  expect(receipt).toContain("in 200");
  expect(receipt).toContain("$0.030");
  expect(agents).toBe("agents · 2 runs · in 1k · out 200 · $0.050 · turn total $0.080 · haiku-4-5-20251001");
  expect(session).toBe("session · 1 turn · 2 agent runs · 1.5k tokens · $0.080");

  // The next turn starts clean, and the session keeps counting.
  state.usd = 0.09;
  const next = await complete($, turn("more", usage(100, 10)));
  expect(next.some((l) => l.startsWith("agents ·"))).toBe(false);
  expect(next).toContain("session · 2 turns · 2 agent runs · 1.6k tokens · $0.090");
});

test("folds subagents into the turn when the agents option is off", { options: { showSubAgentDetails: false } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.02;
  await $.agent.spawn(spawn());
  state.usd = 0.07;
  await $.turn.complete(turn("found", usage(500, 100), "agent-1"));
  state.usd = 0.08;
  const r = await complete($, turn("done", usage(200, 50)));

  expect(r.some((l) => l.startsWith("agents ·"))).toBe(false);
  expect(r).toContain("receipt · in 200 · out 50 · $0.080 · haiku-4-5-20251001");
  expect(r).toContain("session · 1 turn · 1 agent run · 850 tokens · $0.080");
});

test("says cost n/a where the host keeps no ledger", async ($, on) => {
  noLedger(on);
  await $.session.start(START);

  await $.agent.spawn(spawn());
  await $.turn.complete(turn("found", usage(500, 100), "agent-1"));
  const [receipt, agents, session] = await complete($, turn("hi", usage(10, 5)));

  expect(receipt).toBe("receipt · in 10 · out 5 · cost n/a · haiku-4-5-20251001");
  expect(agents).toBe("agents · 1 run · in 500 · out 100 · cost n/a · turn total cost n/a · haiku-4-5-20251001");
  expect(session).toBe("session · 1 turn · 1 agent run · 615 tokens · cost n/a");
});

test("saves the session's total every N turns, at the end, and on /receipt", { options: { saveEveryNNTurns: 2 } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.01;
  await $.turn.complete(turn("one", usage(100, 50)));
  expect(store.get("session:s1")).toBeUndefined();

  state.usd = 0.02;
  await $.turn.complete(turn("two", usage(100, 50)));
  expect(store.get("session:s1")).toEqual({
    id: "s1",
    startedAt: 0,
    savedAt: NOW,
    turns: 2,
    agentRuns: 0,
    tokens: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    agentTokens: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    usd: 0.02,
    banked: { turns: 2, agentRuns: 0, tokens: tok(200, 100), agentTokens: tok(0, 0), usd: 0.02, months: [MONTH] },
  });

  state.usd = 0.03;
  await $.turn.complete(turn("three", usage(100, 50)));
  const shown = await $.command.run(run("receipt"));
  expect(shown.text).toContain("This session (s1):");
  expect(shown.text).toContain("turns 3 | agent runs 0 | $0.030");
  expect(shown.text).toContain("tokens 450: in:300 | out:150");
  expect(shown.text).toContain("Saved.");
  expect(store.get("session:s1")).toMatchObject({ turns: 3, usd: 0.03 });

  state.usd = 0.04;
  await $.turn.complete(turn("four", usage(100, 50)));
  await $.turn.complete(turn("five", usage(100, 50)));
  await $.session.end(END);
  expect(store.get("session:s1")).toMatchObject({ turns: 5, usd: 0.04 });
});

test("does not save a session that has nothing in it", { options: { saveEveryNNTurns: 1 } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  // Nothing yet: /receipt says so, and neither the record nor the month is written.
  const empty = await $.command.run(run("receipt"));
  expect(empty.text).toContain("turns 0 | agent runs 0 | $0.00");
  expect(empty.text).toContain("Not saved: nothing to save yet.");
  expect(store.get("session:s1")).toBeUndefined();
  expect(store.get(`month:${MONTH}`)).toBeUndefined();

  await $.session.end(END);
  expect(store.get("session:s1")).toBeUndefined();
  expect(store.keys().next().done).toBe(true);

  // The first turn makes it worth keeping; from then on it saves as usual.
  state.usd = 0.01;
  await $.turn.complete(turn("one", usage(100, 50)));
  expect(store.get("session:s1")).toMatchObject({ turns: 1, usd: 0.01 });
  expect(store.get(`month:${MONTH}`)).toMatchObject({ sessions: 1, turns: 1, usd: 0.01 });
  const shown = await $.command.run(run("receipt"));
  expect(shown.text).toContain("Saved.");
});

test("continues a saved session's count after a reload or resume", async ($, on) => {
  const state = { usd: 1.0 };
  ledger(on, state, {
    "session:s1": { id: "s1", startedAt: 0, savedAt: NOW - DAY, turns: 7, agentRuns: 2, tokens: usage(1000, 500), agentTokens: usage(300, 100), usd: 1.0 },
  });
  await $.session.start(START);

  state.usd = 1.1;
  expect(await complete($, turn("more", usage(100, 50)))).toContain("session · 8 turns · 2 agent runs · 2.1k tokens · $1.10");
});

test("totals the sessions saved in the last N days", { options: { keepSessionDetailsNNDays: 90 } }, async ($, on) => {
  const state = { usd: 0.5 };
  const rec = (id: string, daysAgo: number, turns: number, usd: number) => ({
    id, startedAt: 0, savedAt: NOW - daysAgo * DAY, turns, agentRuns: 1, tokens: usage(1000, 100), agentTokens: usage(0, 0), usd,
  });
  ledger(on, state, {
    "session:old": rec("old", 100, 20, 9.99),
    "session:a": rec("a", 10, 3, 0.25),
    "session:b": rec("b", 2, 4, 0.75),
    "other:key": { kept: true },
  });
  await $.session.start(START);

  const month = await $.command.run(run("receipt-total"));
  // s1 (this session, 0 turns, $0.50) is saved by the command and counted too.
  expect(month.text).toContain("Last 90 days: 3 sessions");
  expect(month.text).toContain("turns 7 | agent runs 2 | $1.50");
  expect(month.text).toContain("tokens 2.2k: in:2k | out:200");

  const week = await $.command.run(run("receipt-total", "7"));
  expect(week.text).toContain("Last 7 days: 2 sessions");
  expect(week.text).toContain("turns 4 | agent runs 1 | $1.25");

  const none = await $.command.run(run("receipt-total", "1"));
  expect(none.text).toContain("Last 1 day: 1 session");

  // The 100-day-old record was pruned at session start (keepSessionDetailsNNDays 90); unrelated keys stay.
  expect(store.get("session:old")).toBeUndefined();
  expect(store.get("other:key")).toEqual({ kept: true });
});

test("passes the answer through when nothing counted", async ($, on) => {
  noLedger(on);
  await $.session.start(START);

  const r = await $.turn.complete(turn("interrupted"));
  expect(r.text).toBe("interrupted");
});

test("counts a turn without usage when allowEmptyReceipts is on", { options: { allowEmptyReceipts: true } }, async ($, on) => {
  noLedger(on);
  await $.session.start(START);

  expect(await complete($, turn("interrupted"))).toEqual([
    "receipt · in 0 · out 0 · cost n/a",
    "session · 1 turn · 0 tokens · cost n/a",
  ]);

  // A later real turn goes on counting from there.
  const next = await complete($, turn("hi", usage(10, 5)));
  expect(next[1]).toBe("session · 2 turns · 15 tokens · cost n/a");
});

test("banks each save's new turns into the month's tally once", { options: { saveEveryNNTurns: 2 } }, async ($, on) => {
  const state = { usd: 0 };
  ledger(on, state);
  await $.session.start(START);

  state.usd = 0.25;
  await $.turn.complete(turn("one", usage(100, 50)));
  expect(store.get(`month:${MONTH}`)).toBeUndefined();

  state.usd = 0.5;
  await $.turn.complete(turn("two", usage(100, 50)));
  expect(store.get(`month:${MONTH}`)).toEqual({
    month: MONTH,
    savedAt: NOW,
    sessions: 1,
    turns: 2,
    agentRuns: 0,
    tokens: tok(200, 100),
    agentTokens: tok(0, 0),
    usd: 0.5,
  });

  // A third turn, then two saves in a row: the second adds nothing.
  state.usd = 0.75;
  await $.turn.complete(turn("three", usage(100, 50)));
  await $.command.run(run("receipt"));
  await $.command.run(run("receipt"));
  expect(store.get(`month:${MONTH}`)).toMatchObject({ sessions: 1, turns: 3, usd: 0.75, tokens: tok(300, 150) });

  // Subagent runs bank too, and the session record says what is banked.
  await $.agent.spawn(spawn());
  state.usd = 1;
  await $.turn.complete(turn("found", usage(500, 100), "agent-1"));
  state.usd = 1.25;
  await $.turn.complete(turn("four", usage(100, 50)));
  await $.session.end(END);
  expect(store.get(`month:${MONTH}`)).toMatchObject({ sessions: 1, turns: 4, agentRuns: 1, usd: 1.25, agentTokens: tok(500, 100) });
  expect(store.get("session:s1")).toMatchObject({
    turns: 4,
    banked: { turns: 4, agentRuns: 1, tokens: tok(400, 200), agentTokens: tok(500, 100), usd: 1.25, months: [MONTH] },
  });
});

test("a resumed session banks only what it spent since its last save", async ($, on) => {
  const state = { usd: 1.0 };
  const saved = { id: "s1", startedAt: 0, savedAt: NOW - DAY, turns: 7, agentRuns: 2, tokens: tok(1000, 500), agentTokens: tok(300, 100), usd: 1.0 };
  ledger(on, state, {
    "session:s1": { ...saved, banked: { ...saved, months: [MONTH] } },
    [`month:${MONTH}`]: { month: MONTH, savedAt: NOW - DAY, sessions: 3, turns: 20, agentRuns: 5, tokens: tok(5000, 1000), agentTokens: tok(0, 0), usd: 4.0 },
    "month:1970-03": { month: "1970-03", savedAt: NOW - 40 * DAY, sessions: 2, turns: 9, agentRuns: 0, tokens: tok(900, 90), agentTokens: tok(0, 0), usd: 0.5 },
  });
  await $.session.start(START);

  state.usd = 1.5;
  await $.turn.complete(turn("more", usage(100, 50)));
  const r = await $.command.run(run("receipt-month"));

  // The month gained one turn, 150 tokens and 50 cents, not the whole session.
  expect(store.get(`month:${MONTH}`)).toMatchObject({ sessions: 3, turns: 21, agentRuns: 5, usd: 4.5, tokens: tok(5100, 1050) });
  const [head, counts, tokens, label, earlier] = (r.text ?? "").split("\n");
  expect(head).toBe(`${MONTH}: 3 sessions`);
  expect(counts).toBe("  turns 21 | agent runs 5 | $4.50");
  expect(tokens).toBe("  tokens 6.2k: in:5.1k | out:1.1k");
  expect(label).toBe("Earlier months:");
  expect(earlier).toBe("  1970-03 | 2 sessions | 9 turns | $0.500");

  const named = await $.command.run(run("receipt-month", "1970-03"));
  expect(named.text).toContain("1970-03: 2 sessions");
  expect(named.text).not.toContain("Earlier");

  const none = await $.command.run(run("receipt-month", "1969-01"));
  expect(none.text).toBe("Nothing saved for 1969-01.");
});

test("a record saved before the monthly tally banks from zero", async ($, on) => {
  const state = { usd: 2.0 };
  ledger(on, state, {
    "session:s1": { id: "s1", startedAt: 0, savedAt: NOW - DAY, turns: 3, agentRuns: 0, tokens: tok(300, 30), agentTokens: tok(0, 0), usd: 2.0 },
  });
  await $.session.start(START);

  state.usd = 2.5;
  await $.turn.complete(turn("more", usage(100, 50)));
  await $.command.run(run("receipt"));
  expect(store.get(`month:${MONTH}`)).toMatchObject({ sessions: 1, turns: 4, usd: 2.5, tokens: tok(400, 80) });
});

test("drops old session records at start and on /receipt-clear, keeping the months", { options: { keepSessionDetailsNNDays: 3 } }, async ($, on) => {
  const state = { usd: 0 };
  const rec = (id: string, daysAgo: number) => ({
    id, startedAt: 0, savedAt: NOW - daysAgo * DAY, turns: 2, agentRuns: 0, tokens: tok(100, 10), agentTokens: tok(0, 0), usd: 0.1,
  });
  const tally = (month: string, daysAgo: number) => ({
    month, savedAt: NOW - daysAgo * DAY, sessions: 1, turns: 2, agentRuns: 0, tokens: tok(100, 10), agentTokens: tok(0, 0), usd: 0.1,
  });
  ledger(on, state, {
    "session:old": rec("old", 5),
    "session:recent": rec("recent", 1),
    "month:1960-01": tally("1960-01", 3000),
    "month:1970-03": tally("1970-03", 40),
  });
  await $.session.start(START);

  // keepSessionDetailsNNDays 3: the 5-day-old session goes; months stay for 12 months.
  expect(store.get("session:old")).toBeUndefined();
  expect(store.get("session:recent")).not.toBeUndefined();
  expect(store.get("month:1960-01")).toBeUndefined();
  expect(store.get("month:1970-03")).not.toBeUndefined();

  // The total's default window is the kept days. This session counts once it
  // has a turn; empty, it would not be saved.
  state.usd = 0.05;
  await $.turn.complete(turn("one", usage(10, 5)));
  const total = await $.command.run(run("receipt-total"));
  expect(total.text).toContain("Last 3 days: 2 sessions");

  const cleared = await $.command.run(run("receipt-clear"));
  expect(cleared.text).toBe("Dropped 1 session record. This session's record and the monthly tallies are kept.");
  expect(store.get("session:recent")).toBeUndefined();
  expect(store.get("session:s1")).not.toBeUndefined();
  expect(store.get("month:1970-03")).not.toBeUndefined();
});
