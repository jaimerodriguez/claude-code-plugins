# claude-code-plugins

An exploration of Claude Code Plugins. Most of these are for learning purposes.

This repository is also a plugin marketplace (`.claude-plugin/marketplace.json`). Install any plugin here from a Claude Code session:

```text
/plugin install <name> --marketplace jaimerodriguez/claude-code-plugins
```

| Plugin | What it does |
| --- | --- |
| [`turn-receipt/`](turn-receipt/) | Prints a receipt after an LLM call. The receipt shows the turn's tokens and cost in US dollars, its subagents' share, and the session's running total. Commands: `/receipt` (this session), `/receipt-total N` (the kept sessions over the last N days), `/receipt-month` (a calendar month's tally) and `/receipt-clear` (drops the session records, keeps the months). |

Each plugin's README covers how to install, build, test and debug it.

## License

This repository is under the [MIT License](LICENSE), except `turn-receipt/`, whose sources began as an Anthropic example and stay under the [Apache License 2.0](turn-receipt/LICENSE). Each plugin's README says which applies to it.
