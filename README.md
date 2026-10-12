# claude-code-plugins

An exploration of Claude Code Plugins. Most of these are for learning purposes.

This repository is also a plugin marketplace (`.claude-plugin/marketplace.json`). Install any plugin here from a Claude Code session:

```text
/plugin install <name> --marketplace jaimerodriguez/claude-code-plugins
```

| Plugin | What it does |
| --- | --- |
| [`turn-receipt/`](turn-receipt/) | Prints a receipt after an LLM call. The receipt shows the turn's tokens and cost in US dollars, its subagents' share, and the session's running total. Supported commands include `/receipt` (last turn), `/receipt-total XX days (totals tallied over XX days), and `/receipt-month` (receipt for past 30 days)|

Each plugin's README covers how to install, build, test and debug it.
