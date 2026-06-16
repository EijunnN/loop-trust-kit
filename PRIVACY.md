# Privacy Policy — Loop Trust Kit

_Last updated: 2026-06-16_

Loop Trust Kit ("the plugin") is an open-source, dependency-free toolkit that
runs entirely on your own machine, inside your coding agent (Claude Code, Codex,
or similar).

## What it collects

**Nothing.** The plugin does not collect, store, transmit, or share any personal
data, usage data, or telemetry. It has no analytics, no tracking, and makes no
network requests of its own.

## How it handles your data

- Its agents are plain instructions, and its scripts are local Node.js files
  (`validate-report.mjs`, `loop-budget.mjs`, `triage.mjs`) that only read and
  write Evidence Report files under `.loop/runs/` **in your own repository**.
- Everything it reads or writes stays on your machine and in your own version
  control. Nothing leaves your environment because of this plugin.

## Third parties

The plugin runs inside a host coding agent (for example, Claude Code). Any data
handling by that host tool is governed by the host's own privacy policy, not by
this plugin. The plugin itself sends nothing to any third party.

## Changes

Any update to this policy is committed to this repository, with the date above.

## Contact

Privacy questions: eijunxd12@gmail.com
