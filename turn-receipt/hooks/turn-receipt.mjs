// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0
//
// Turn Receipt: a receipt beneath each answer, with the subagents' share.
//
// turn.complete (main loop): read the turn's token counts from e.usage (what
// the API reported, summed over the turn's requests) and the session's cost
// from $.session.usage() (the same ledger /cost totals). Keep the receipt as
// markdown, the answer passed through untouched. With `renderReceiptAs` "ui", a
// ui.render hook on the TurnDuration row (the line that closes the turn) draws
// that markdown beneath the turn's duration: one list item per section, the
// numbers in bold. "text" returns the receipt instead as the hook's text, one
// line (the engine replaces every line break in it), plain. "none" shows
// nothing each turn; only the ui.render hook is left unregistered, every other
// hook stays, so the tally, the saves and the commands go on.
// turn.complete (a subagent's run, e.agentId set): count the run and its
// tokens toward the current main turn's "agents" line.
// agent.spawn: take a ledger reading before the subagent starts.
// session.start: take a baseline, so a resumed session's earlier spend is not
// billed to its first turn.
//
// Dollars per loop: the API prices nothing per agent, so the mod reads the
// ledger at each spawn and at each turn's end, and credits each movement to
// the loop whose event ended the window: a spawn credits the main loop, a
// subagent run's end credits the agents, the main turn's end credits the main
// loop. A foreground subagent blocks the main loop while it runs, so for those
// the split is exact. A background subagent runs beside the main loop, so what
// the main loop spends meanwhile is credited to the agents.
//
// Persistence: two kinds of record in $.store, never written on every event.
// The session's running total is one record under `session:<id>`, written
// every `saveEveryNNTurns` turns, at session.end, and by the commands. session.start
// reads it back, so a resumed session or a reloaded module continues its
// count. Each month's tally is one record under `month:<YYYY-MM>`: at every
// save, what the session added since its last save is banked into the month
// of the save, and the session record notes how much is banked, so nothing is
// counted twice. Session records are short-lived (`keepSessionDetailsNNDays`, 14 by default;
// /receipt-clear drops them on demand) and the months stay (12 kept), so the
// store stays small whatever the session count.
//
// Why bank, instead of summing the session records when a month is asked for:
// the two kinds of record have different lives. Session records are dropped
// after `keepSessionDetailsNNDays` and by /receipt-clear, so by the time a month is asked for
// most of its sessions are gone; the month has to be written while they are
// still here. And it has to be written a little at a time, at every save, not
// once at session.end: a session can be killed before session.end fires,
// resumed days later, or have its module reloaded mid-count, and a session
// that runs past midnight on the last day of a month owes part of itself to
// each month. So each save moves the session's unbanked part (its total minus
// `banked`) into the month of the save, then records the new `banked` in the
// session record. That subtraction is what makes saves safe to repeat: a
// session saved ten times is counted once, a resumed session goes on from
// where its record left off, and a save that added nothing leaves the month
// alone. Dollars need one more care: the ledger is a running total for the
// whole session, not a per-turn count, so `banked.usd` holds the ledger
// reading the next bank subtracts from (the reading at session.start for a
// fresh session, so a resumed session's earlier spend, banked already, is not
// banked again). The month is written before the session record, so a crash
// between the two writes can count a part once more but never lose it.
// /receipt-total [days] sums the session records saved in the last N days.
// /receipt-month [YYYY-MM] shows a month's tally, the current one by default.
// At session.start the module prints a trace to the console: the host's
// process id, what the session's record had banked, and every month kept.
//
// Options (plugin.json userConfig, set in /config): `showSessionTotals`, on
// by default, adds the session's running total; `showSubAgentDetails`, on by
// default, adds a line for the subagent runs the turn made; `saveEveryNNTurns`,
// 10 by default, is how many turns pass between saves (0: only at session end
// and on the commands); `keepSessionDetailsNNDays`, 14 by default, is how long
// session records are kept;
// `allowEmptyReceipts`, off by default, prints a receipt (and counts the
// turn) when the turn reported no usage and moved no ledger, such as an
// interrupt before any response; its token counts read 0.
// `renderReceiptAs`: "ui" (default) draws the receipt as markdown with a
// ui.render hook on TurnDuration; "text" returns it as the turn.complete text,
// one line; "none" only tallies and saves. The receipt's lines follow the
// options above: the turn, its subagents (when shown and there were runs) and
// the session (when shown).
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

const SEP = " | ";
const DOT = " · ";
const SECTION_SEP = " // ";
const RENDER_MODES = ["ui", "text", "none"];
const MODEL_PREFIX = "claude-";
const KEY = "session:";
const MONTH_KEY = "month:";
const KEEP_MONTHS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const SAVE_EVERY_DEFAULT = 10;
const KEEP_DAYS_DEFAULT = 14;
const ALLOW_EMPTY_RECEIPTS_DEFAULT = false;
const RENDER_AS_DEFAULT = "ui";
const KEEP_DRAWN = 200;

let showSession = true;
let showAgents = true;
let saveEvery = SAVE_EVERY_DEFAULT;
let keepDays = KEEP_DAYS_DEFAULT;
let allowEmptyReceipts = ALLOW_EMPTY_RECEIPTS_DEFAULT;
let renderAs = RENDER_AS_DEFAULT;

// The latest turn's receipt, as markdown, until a TurnDuration row claims it;
// and the receipts the rows already drew, by row, so a redraw keeps its own.
let pending = null;
const drawn = new Map();

// This session's id and when it began, from session.start; null before it.
let sessionId = null;
let startedAt = 0;

// The ledger's total at the last reading, in US dollars; null before any.
let lastUsd = null;

// The main turn in progress.
let turn = emptyTurn();

// The session: main-loop turns receipted, subagent runs, and their tokens.
let session = emptySession();

// How much of the session is already in a month's tally, and which months.
// Saved in the session record beside the totals, so a resume or a reload
// knows what not to bank again. See "Why bank" above.
let banked = emptyBanked(null);

export function register(on, options) {
  showSession = options?.showSessionTotals !== false;
  showAgents = options?.showSubAgentDetails !== false;
  saveEvery = Math.max(0, Math.floor(Number(options?.saveEveryNNTurns ?? SAVE_EVERY_DEFAULT)) || 0);
  keepDays = Math.max(1, Math.floor(Number(options?.keepSessionDetailsNNDays ?? KEEP_DAYS_DEFAULT)) || KEEP_DAYS_DEFAULT);
  allowEmptyReceipts = options?.allowEmptyReceipts === true;
  renderAs = RENDER_MODES.includes(options?.renderReceiptAs) ? options.renderReceiptAs : RENDER_AS_DEFAULT;

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.command.register({
      name: "receipt",
      description: "Show this session's turns, subagent runs, tokens and cost, and save them.",
    });
    await $.command.register({
      name: "receipt-total",
      description: "Total the saved sessions of the last N days (the kept days by default).",
      argumentHint: "[days]",
    });
    await $.command.register({
      name: "receipt-month",
      description: "Show a month's tally of sessions, turns, tokens and cost (this month by default).",
      argumentHint: "[YYYY-MM]",
    });
    await $.command.register({
      name: "receipt-clear",
      description: "Save this session, then drop the other saved session records. The monthly tallies stay.",
    });
    turn = emptyTurn();
    session = emptySession();
    lastUsd = await readLedger($);
    banked = emptyBanked(lastUsd);
    await loadSession($);
    await prune($);
    try {
      await trace($);
    } catch {
      // Tracing never fails the start.
    }
    return result;
  });

  // The last save: a short, bounded step, so the exit stays fast.
  on("session.end", async ($, e, next) => {
    await save($);
    return next(e);
  });

  on("command.run", { command: "receipt" }, async ($) => {
    await save($);
    return { text: sessionReport() };
  });

  on("command.run", { command: "receipt-total" }, async ($, e) => {
    const days = Math.max(1, Math.floor(Number(e.args.trim())) || keepDays);
    await save($);
    return { text: await totalReport($, days) };
  });

  on("command.run", { command: "receipt-month" }, async ($, e) => {
    await save($);
    return { text: await monthReport($, e.args.trim()) };
  });

  on("command.run", { command: "receipt-clear" }, async ($) => {
    await save($);
    return { text: await clearReport($) };
  });

  // The ledger up to a spawn is the main loop's. An observer: whatever
  // happens to the reading, the spawn goes on.
  on("agent.spawn", async ($, e, next) => {
    turn.mainUsd = addUsd(turn.mainUsd, await ledgerDelta($));
    return next(e);
  }).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    const usage = e.usage ?? result.usage ?? null;
    const delta = await ledgerDelta($);

    if (e.agentId) {
      turn.agentUsd = addUsd(turn.agentUsd, delta);
      turn.agentRuns += 1;
      session.agentRuns += 1;
      if (usage) {
        turn.agentTokens = addTokens(turn.agentTokens, usage);
        session.agentTokens = addTokens(session.agentTokens, usage);
        turn.agentModel = usage.model ?? turn.agentModel;
      }
      return result;
    }

    pending = null;
    turn.mainUsd = addUsd(turn.mainUsd, delta);
    if (!usage && turn.mainUsd === null && turn.agentRuns === 0 && !allowEmptyReceipts) {
      return result;
    }
    session.turns += 1;
    if (usage) {
      session.mainTokens = addTokens(session.mainTokens, usage);
    }
    const lines = renderAs === "none" ? [] : receiptLines(usage, turn, session, lastUsd, renderAs === "ui");
    turn = emptyTurn();
    if (saveEvery > 0 && session.turns % saveEvery === 0) {
      await save($);
    }
    if (renderAs === "ui") {
      pending = lines.map((line) => `- ${line}`).join("\n");
    } else if (renderAs === "text") {
      // One line: the engine replaces every line break in a hook's text.
      return { ...result, text: lines.join(SECTION_SEP) };
    }
    return result;
  });

  if (renderAs === "ui") {
    // The row that closes a turn. It claims the receipt the turn left, once;
    // a redraw of the same row gets the same receipt back. A row with none
    // (an empty turn, a subagent's) is the engine's own.
    on("ui.render", { component: "TurnDuration" }, async ($, e, next) => {
      const id = String(e.requestId ?? "");
      let text = drawn.get(id);
      if (text === undefined && pending !== null) {
        text = pending;
        pending = null;
        drawn.set(id, text);
        if (drawn.size > KEEP_DRAWN) {
          drawn.delete(drawn.keys().next().value);
        }
      }
      if (text === undefined) {
        return next(e);
      }
      const { Box, Text, Markdown } = $.ui.resolve(e);
      return Box({
        flexDirection: "column",
        children: [
          Text({ dimColor: true, children: `${e.props.word} for ${duration(e.props.durationMs)}` }),
          Markdown({ text }),
        ],
      });
    });
  }
}

// The turn's length as the closing line says it: `3s`, `1m 4s`.
function duration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}

// ---- persistence ----

async function loadSession($) {
  try {
    sessionId = await $.session.id();
    startedAt = (await $.session.usage()).startedAt ?? 0;
    const record = await $.store.get(KEY + sessionId);
    if (record && typeof record === "object") {
      session.turns = record.turns ?? 0;
      session.agentRuns = record.agentRuns ?? 0;
      session.mainTokens = addTokens(emptyTokens(), record.tokens ?? {});
      session.agentTokens = addTokens(emptyTokens(), record.agentTokens ?? {});
      // A record from before the monthly tally has nothing banked yet, and
      // its dollars are the whole ledger, so they bank from zero.
      banked = readBanked(record.banked) ?? emptyBanked(0);
    }
  } catch {
    // No store or no id: the session counts from zero and is not saved.
    sessionId = null;
  }
}

export function record(now) {
  return {
    id: sessionId,
    startedAt,
    savedAt: now,
    turns: session.turns,
    agentRuns: session.agentRuns,
    tokens: session.mainTokens,
    agentTokens: session.agentTokens,
    usd: lastUsd,
    banked,
  };
}

async function save($) {
  if (sessionId === null || isEmpty()) {
    return false;
  }
  try {
    const now = await $.clock.now();
    await bank($, now);
    await $.store.set(KEY + sessionId, record(now));
    return true;
  } catch {
    return false;
  }
}

// A session with nothing in it: no turns, no subagent runs, no tokens, and a
// ledger at zero (or none). Saving it would only litter the store with empty
// records, one per session opened and closed without a prompt, so save() does
// not. Once it has anything, every save after is written as usual.
function isEmpty() {
  return (
    session.turns === 0 &&
    session.agentRuns === 0 &&
    sum(session.mainTokens) + sum(session.agentTokens) === 0 &&
    !(lastUsd > 0)
  );
}

// What the session has added since its last save: its totals minus `banked`.
// This is the only part a save may add to a month; the rest is there already.
// Null dollars where the ledger gave none to compare.
function unbanked() {
  return {
    turns: session.turns - banked.turns,
    agentRuns: session.agentRuns - banked.agentRuns,
    tokens: subTokens(session.mainTokens, banked.tokens),
    agentTokens: subTokens(session.agentTokens, banked.agentTokens),
    usd: lastUsd === null || banked.usd === null ? null : Math.max(0, lastUsd - banked.usd),
  };
}

// Adds the session's unbanked part to the tally of the month `now` falls in,
// then marks it banked by setting `banked` to the session's current totals.
// Called from every save, so the month grows by increments and a session that
// ends without session.end has still banked up to its last save. A session
// that added nothing is not counted, and one that banks into a month it has
// not seen before counts as one more of that month's sessions. The month is
// written first: if the session record's write is lost, the next save banks
// this increment again (counting it once more), which beats losing it.
async function bank($, now) {
  const d = unbanked();
  if (d.turns === 0 && d.agentRuns === 0 && sum(d.tokens) + sum(d.agentTokens) === 0 && !(d.usd > 0)) {
    return;
  }
  const month = monthOf(now);
  const key = MONTH_KEY + month;
  const m = readMonth(await $.store.get(key), month);
  const isNew = !banked.months.includes(month);
  await $.store.set(key, {
    month,
    savedAt: now,
    sessions: m.sessions + (isNew ? 1 : 0),
    turns: m.turns + d.turns,
    agentRuns: m.agentRuns + d.agentRuns,
    tokens: addTokens(m.tokens, d.tokens),
    agentTokens: addTokens(m.agentTokens, d.agentTokens),
    usd: addUsd(m.usd, d.usd),
  });
  banked = {
    turns: session.turns,
    agentRuns: session.agentRuns,
    tokens: session.mainTokens,
    agentTokens: session.agentTokens,
    usd: lastUsd ?? banked.usd,
    months: isNew ? [...banked.months, month] : banked.months,
  };
}

// Drops session records older than keepDays (never this session's) and
// months older than the KEEP_MONTHS kept.
async function prune($) {
  try {
    const now = await $.clock.now();
    const cutoff = now - keepDays * DAY_MS;
    const oldest = monthOf(now, 1 - KEEP_MONTHS);
    for (const key of await $.store.keys()) {
      if (key.startsWith(KEY)) {
        if (key === KEY + sessionId) continue;
        const r = await $.store.get(key);
        if (!r || typeof r !== "object" || (r.savedAt ?? 0) < cutoff) {
          await $.store.delete(key);
        }
      } else if (key.startsWith(MONTH_KEY)) {
        if (key.slice(MONTH_KEY.length) < oldest) {
          await $.store.delete(key);
        }
      }
    }
  } catch {
    // The store keeps what it has.
  }
}

// `YYYY-MM` of the local month `ms` falls in, moved by `offset` months.
export function monthOf(ms, offset = 0) {
  const d = new Date(ms);
  const index = d.getFullYear() * 12 + d.getMonth() + offset;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

// ---- tracing ----

// Prints to the console, at session.start, where the tally stands: the
// host's process id (to attach a debugger to), what this session's record
// had banked, and every month record kept. A hooks module has no `process`
// of its own, so the id is read from a child's $PPID; where the console is
// missing, the lines go to the debug log. Never fails the start.
async function trace($) {
  const lines = [
    `turn-receipt session.start: host pid ${await hostPid($)}`,
    `  session ${sessionId ?? "(none)"}: turns ${session.turns}, agent runs ${session.agentRuns}, ledger ${dollars(lastUsd)}`,
    `  banked: turns ${banked.turns}, agent runs ${banked.agentRuns}, tokens ${sum(banked.tokens) + sum(banked.agentTokens)}, ${dollars(banked.usd)}, months ${banked.months.join(", ") || "none"}`,
  ];
  try {
    const months = [];
    for (const key of await $.store.keys()) {
      if (!key.startsWith(MONTH_KEY)) continue;
      const m = readMonth(await $.store.get(key), key.slice(MONTH_KEY.length));
      months.push(`  month ${m.month}: sessions ${m.sessions}, turns ${m.turns}, agent runs ${m.agentRuns}, tokens ${sum(m.tokens) + sum(m.agentTokens)}, ${dollars(m.usd)}`);
    }
    lines.push(...(months.length > 0 ? months.sort() : ["  months: none"]));
  } catch (err) {
    lines.push(`  months: store unreadable (${err?.message ?? err})`);
  }
  const text = lines.join("\n");
  try {
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log(text);
    } else {
      $.ui.log(text, { to: "debug" });
    }
  } catch {
    // Nowhere to print: the start goes on.
  }
}

// The host process's id, as a child it starts sees its parent; "unknown"
// where no child can run (the test kit, a host without $.process).
async function hostPid($) {
  try {
    const { exitCode, stdout } = await $.process.run(["sh", "-c", "echo $PPID"], { timeoutMs: 5000 });
    const pid = stdout.trim();
    return exitCode === 0 && /^\d+$/.test(pid) ? pid : "unknown";
  } catch {
    return "unknown";
  }
}

// ---- reports ----

function sessionReport() {
  const tokens = addTokens(session.mainTokens, session.agentTokens);
  const lines = [
    `This session${sessionId ? ` (${sessionId})` : ""}:`,
    `  turns ${session.turns}${SEP}agent runs ${session.agentRuns}${SEP}${dollars(lastUsd)}`,
    `  tokens ${short(sum(tokens))}: ${tokenParts(tokens).join(SEP) || "none"}`,
    sessionId === null ? "Not saved: no session id." : isEmpty() ? "Not saved: nothing to save yet." : "Saved.",
  ];
  return lines.join("\n");
}

async function totalReport($, days) {
  const now = await $.clock.now();
  const cutoff = now - days * DAY_MS;
  const rows = [];
  for (const key of await $.store.keys()) {
    if (!key.startsWith(KEY)) continue;
    const r = await $.store.get(key);
    if (r && typeof r === "object" && (r.savedAt ?? 0) >= cutoff) {
      rows.push(r);
    }
  }
  if (rows.length === 0) {
    return `No sessions saved in the last ${days} ${days === 1 ? "day" : "days"}.`;
  }
  let turns = 0;
  let agentRuns = 0;
  let usd = null;
  let tokens = emptyTokens();
  for (const r of rows) {
    turns += r.turns ?? 0;
    agentRuns += r.agentRuns ?? 0;
    usd = addUsd(usd, typeof r.usd === "number" ? r.usd : null);
    tokens = addTokens(tokens, r.tokens ?? {});
    tokens = addTokens(tokens, r.agentTokens ?? {});
  }
  const lines = [
    `Last ${days} ${days === 1 ? "day" : "days"}: ${rows.length} ${rows.length === 1 ? "session" : "sessions"}`,
    `  turns ${turns}${SEP}agent runs ${agentRuns}${SEP}${dollars(usd)}`,
    `  tokens ${short(sum(tokens))}: ${tokenParts(tokens).join(SEP) || "none"}`,
  ];
  return lines.join("\n");
}

async function monthReport($, arg) {
  const now = await $.clock.now();
  const asked = /^\d{4}-\d{2}$/.test(arg);
  const month = asked ? arg : monthOf(now);
  const r = await $.store.get(MONTH_KEY + month);
  if (!r || typeof r !== "object") {
    return `Nothing saved for ${month}.`;
  }
  const m = readMonth(r, month);
  const tokens = addTokens(m.tokens, m.agentTokens);
  const lines = [
    `${month}: ${m.sessions} ${m.sessions === 1 ? "session" : "sessions"}`,
    `  turns ${m.turns}${SEP}agent runs ${m.agentRuns}${SEP}${dollars(m.usd)}`,
    `  tokens ${short(sum(tokens))}: ${tokenParts(tokens).join(SEP) || "none"}`,
  ];
  if (!asked) {
    const earlier = [];
    for (const key of await $.store.keys()) {
      if (!key.startsWith(MONTH_KEY) || key === MONTH_KEY + month) continue;
      const e = readMonth(await $.store.get(key), key.slice(MONTH_KEY.length));
      earlier.push(`  ${e.month}${SEP}${e.sessions} ${e.sessions === 1 ? "session" : "sessions"}${SEP}${e.turns} ${e.turns === 1 ? "turn" : "turns"}${SEP}${dollars(e.usd)}`);
    }
    if (earlier.length > 0) {
      lines.push("Earlier months:", ...earlier.sort().reverse());
    }
  }
  return lines.join("\n");
}

async function clearReport($) {
  let dropped = 0;
  try {
    for (const key of await $.store.keys()) {
      if (!key.startsWith(KEY) || key === KEY + sessionId) continue;
      await $.store.delete(key);
      dropped += 1;
    }
  } catch {
    return `Dropped ${dropped} session ${dropped === 1 ? "record" : "records"} before the store refused. The monthly tallies are kept.`;
  }
  return `Dropped ${dropped} session ${dropped === 1 ? "record" : "records"}. This session's record and the monthly tallies are kept.`;
}

async function readLedger($) {
  try {
    const { cost } = await $.session.usage();
    return typeof cost?.usd === "number" ? cost.usd : null;
  } catch {
    return null;
  }
}

// How far the ledger moved since the last reading; null where there is none.
async function ledgerDelta($) {
  const usd = await readLedger($);
  if (usd === null) {
    return null;
  }
  const delta = lastUsd === null ? null : Math.max(0, usd - lastUsd);
  lastUsd = usd;
  return delta;
}

// The receipt's lines: the turn, its subagents (when shown and there were
// runs) and the session (when shown). With `md`, as markdown, the numbers in
// bold and the fields joined by ·; else plain, `in:200`, joined by |.
export function receiptLines(usage, t, s, sessionUsd, md) {
  const lines = [];
  const sep = md ? DOT : SEP;
  const b = (x) => (md ? `**${x}**` : String(x));
  const fmt = md ? b : undefined;
  const agentsShown = showAgents && t.agentRuns > 0;
  // With the agents line off, the turn's figure is the whole turn, agents included.
  const turnUsd = agentsShown ? t.mainUsd : addUsd(t.mainUsd, t.agentUsd);
  const tag = (model) => (model ? `${sep}${shortModel(model)}` : "");

  // No usage reads as zeros, so the line keeps its shape for anything parsing it.
  const main = [b("receipt"), ...tokenParts(usage ?? emptyTokens(), fmt), b(dollars(turnUsd))];
  lines.push(main.join(sep) + tag(usage?.model));

  if (agentsShown) {
    const agents = [
      b("agents"),
      `${b(t.agentRuns)} ${t.agentRuns === 1 ? "run" : "runs"}`,
      ...tokenParts(t.agentTokens, fmt),
      b(dollars(t.agentUsd)),
      `turn total ${b(dollars(addUsd(t.mainUsd, t.agentUsd)))}`,
    ];
    lines.push(agents.join(sep) + tag(t.agentModel));
  }

  if (showSession) {
    const parts = [b("session"), `${b(s.turns)} ${s.turns === 1 ? "turn" : "turns"}`];
    if (s.agentRuns > 0) {
      parts.push(`${b(s.agentRuns)} agent ${s.agentRuns === 1 ? "run" : "runs"}`);
    }
    parts.push(`${b(short(sum(addTokens(s.mainTokens, s.agentTokens))))} tokens`);
    parts.push(b(dollars(sessionUsd)));
    lines.push(parts.join(sep));
  }

  return lines;
}

// `in:1.2k`, `out:348` and the cache counts shown; with `fmt`, as markdown
// does it, `in **1.2k**`.
function tokenParts(usage, fmt) {
  if (!usage) {
    return [];
  }
  const part = (label, n) => (fmt ? `${label} ${fmt(short(n))}` : `${label}:${short(n)}`);
  const parts = [part("in", usage.input_tokens), part("out", usage.output_tokens)];
  if (usage.cache_read_input_tokens > 0) {
    parts.push(part("cache read", usage.cache_read_input_tokens));
  }
  if (usage.cache_creation_input_tokens > 0) {
    parts.push(part("cache write", usage.cache_creation_input_tokens));
  }
  return parts;
}

// Every model id starts with "claude-"; the receipt shows the rest.
export function shortModel(model) {
  return model.startsWith(MODEL_PREFIX) && model.length > MODEL_PREFIX.length ? model.slice(MODEL_PREFIX.length) : model;
}

function emptyTurn() {
  return { mainUsd: null, agentUsd: null, agentRuns: 0, agentTokens: emptyTokens(), agentModel: null };
}

function emptySession() {
  return { turns: 0, agentRuns: 0, mainTokens: emptyTokens(), agentTokens: emptyTokens() };
}

// Nothing banked yet; `usd` is the ledger reading the session's dollars count
// from. For a fresh session that is the reading at session.start, since the
// ledger is a running total and anything before it belongs to an earlier
// session already banked; for a 0.1.x record (no `banked` field) it is zero,
// since that record's `usd` was the whole ledger and none of it is banked.
function emptyBanked(usd) {
  return { turns: 0, agentRuns: 0, tokens: emptyTokens(), agentTokens: emptyTokens(), usd, months: [] };
}

function readBanked(b) {
  if (!b || typeof b !== "object") {
    return null;
  }
  return {
    turns: b.turns ?? 0,
    agentRuns: b.agentRuns ?? 0,
    tokens: addTokens(emptyTokens(), b.tokens ?? {}),
    agentTokens: addTokens(emptyTokens(), b.agentTokens ?? {}),
    usd: typeof b.usd === "number" ? b.usd : null,
    months: Array.isArray(b.months) ? b.months.filter((m) => typeof m === "string") : [],
  };
}

function readMonth(r, month) {
  const m = r && typeof r === "object" ? r : {};
  return {
    month,
    sessions: m.sessions ?? 0,
    turns: m.turns ?? 0,
    agentRuns: m.agentRuns ?? 0,
    tokens: addTokens(emptyTokens(), m.tokens ?? {}),
    agentTokens: addTokens(emptyTokens(), m.agentTokens ?? {}),
    usd: typeof m.usd === "number" ? m.usd : null,
  };
}

function emptyTokens() {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

function addTokens(a, b) {
  return {
    input_tokens: a.input_tokens + (b.input_tokens ?? 0),
    output_tokens: a.output_tokens + (b.output_tokens ?? 0),
    cache_read_input_tokens: a.cache_read_input_tokens + (b.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: a.cache_creation_input_tokens + (b.cache_creation_input_tokens ?? 0),
  };
}

function subTokens(a, b) {
  return {
    input_tokens: Math.max(0, a.input_tokens - b.input_tokens),
    output_tokens: Math.max(0, a.output_tokens - b.output_tokens),
    cache_read_input_tokens: Math.max(0, a.cache_read_input_tokens - b.cache_read_input_tokens),
    cache_creation_input_tokens: Math.max(0, a.cache_creation_input_tokens - b.cache_creation_input_tokens),
  };
}

// Sums two dollar figures, null standing for "no ledger".
function addUsd(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function sum(t) {
  return t.input_tokens + t.output_tokens + t.cache_read_input_tokens + t.cache_creation_input_tokens;
}

export function dollars(usd) {
  if (usd === null) return "cost n/a";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(usd >= 1 ? 2 : 3)}`;
}

export function short(n) {
  if (n >= 1_000_000) return `${tenths(n / 1_000_000)}M`;
  if (n >= 1_000) return `${tenths(n / 1_000)}k`;
  return String(n);
}

// One decimal, rounded half up in tenths, a whole number shown without it.
function tenths(x) {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
