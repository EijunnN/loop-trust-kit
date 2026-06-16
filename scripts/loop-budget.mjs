#!/usr/bin/env node
// loop-budget.mjs — sum the cost of every Evidence Report and (optionally) cap it.
//
// Scans .loop/runs/*.md, reads the `cost:` block from each report's frontmatter,
// sums input_tokens / output_tokens / usd_estimate across all runs, and prints a
// ledger. If .loop/budget.json exists ({"usd": N} and/or {"output_tokens": N}),
// it warns and exits non-zero when cumulative spend exceeds the cap.
//
// Dependency-free. No YAML library, no args parsing lib, no network. Node >= 18.
// Reuses the same minimal frontmatter approach as the validator: slice the block
// between the first two `---` fences and read only the scalar lines we need.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const RUNS_DIR = join(ROOT, ".loop", "runs");
const BUDGET_FILE = join(ROOT, ".loop", "budget.json");

// --- minimal frontmatter extraction (same approach as the validator) ---------
// An Evidence Report is `---\n<yaml>\n---\n<body>`. We only need the leading
// YAML block. Return its raw text, or null if the file has no frontmatter.
function extractFrontmatter(text) {
  // Tolerate a leading BOM and CRLF line endings.
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) return null;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return null;
  return src.slice(4, end);
}

// Pull the `cost:` mapping out of the frontmatter without a YAML parser.
// We find the `cost:` line, then read the indented `key: value` lines under it.
// Only the three numeric scalars we care about are extracted; everything else in
// the report is ignored on purpose (keeps this dependency-free and forgiving).
function parseCost(frontmatter) {
  const lines = frontmatter.split("\n");
  const cost = { input_tokens: null, output_tokens: null, usd_estimate: null };

  let i = lines.findIndex((l) => /^cost:\s*$/.test(l));
  if (i === -1) return cost;

  for (i += 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // A non-indented line means we've left the cost block.
    if (!/^\s/.test(line)) break;
    const m = line.match(/^\s+(input_tokens|output_tokens|usd_estimate):\s*([0-9]*\.?[0-9]+)\s*$/);
    if (m) {
      const n = Number(m[2]);
      if (Number.isFinite(n)) cost[m[1]] = n;
    }
  }
  return cost;
}

function loadBudget() {
  if (!existsSync(BUDGET_FILE)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
  } catch (e) {
    console.error(`loop-budget: ${BUDGET_FILE} is not valid JSON — ${e.message}`);
    process.exit(2);
  }
  const budget = {};
  if (typeof raw.usd === "number" && Number.isFinite(raw.usd)) budget.usd = raw.usd;
  if (typeof raw.output_tokens === "number" && Number.isFinite(raw.output_tokens)) {
    budget.output_tokens = raw.output_tokens;
  }
  if (Object.keys(budget).length === 0) {
    console.error(
      `loop-budget: ${BUDGET_FILE} has no usable cap. Expected {"usd": N} and/or {"output_tokens": N}.`
    );
    process.exit(2);
  }
  return budget;
}

function fmtInt(n) {
  return n.toLocaleString("en-US");
}
function fmtUsd(n) {
  return `$${n.toFixed(2)}`;
}

function main() {
  if (!existsSync(RUNS_DIR)) {
    console.error(`loop-budget: no ${RUNS_DIR} directory — nothing to tally.`);
    process.exit(0);
  }

  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) {
    console.log("loop-budget: no Evidence Reports in .loop/runs/ yet.");
    process.exit(0);
  }

  const rows = [];
  const totals = { input_tokens: 0, output_tokens: 0, usd_estimate: 0 };
  const missing = [];

  for (const file of files) {
    const full = join(RUNS_DIR, file);
    const fm = extractFrontmatter(readFileSync(full, "utf8"));
    if (fm === null) {
      missing.push(`${file} (no frontmatter)`);
      continue;
    }
    const cost = parseCost(fm);
    const hasAny =
      cost.input_tokens !== null ||
      cost.output_tokens !== null ||
      cost.usd_estimate !== null;
    if (!hasAny) missing.push(`${file} (no cost block)`);

    totals.input_tokens += cost.input_tokens ?? 0;
    totals.output_tokens += cost.output_tokens ?? 0;
    totals.usd_estimate += cost.usd_estimate ?? 0;
    rows.push({ run: basename(file, ".md"), ...cost });
  }

  // --- ledger ---------------------------------------------------------------
  console.log("Loop Trust Kit — cost ledger");
  console.log("============================");
  for (const r of rows) {
    const inTok = r.input_tokens === null ? "—" : fmtInt(r.input_tokens);
    const outTok = r.output_tokens === null ? "—" : fmtInt(r.output_tokens);
    const usd = r.usd_estimate === null ? "—" : fmtUsd(r.usd_estimate);
    console.log(`  ${r.run}`);
    console.log(`      in ${inTok}   out ${outTok}   ${usd}`);
  }
  console.log("----------------------------");
  console.log(
    `  TOTAL (${rows.length} run${rows.length === 1 ? "" : "s"})  ` +
      `in ${fmtInt(totals.input_tokens)}   ` +
      `out ${fmtInt(totals.output_tokens)}   ` +
      `${fmtUsd(totals.usd_estimate)}`
  );

  if (missing.length) {
    console.log("");
    console.log("  note: reports with no recorded cost (counted as 0):");
    for (const m of missing) console.log(`    - ${m}`);
  }

  // --- budget enforcement ---------------------------------------------------
  const budget = loadBudget();
  if (!budget) {
    console.log("");
    console.log("  no .loop/budget.json — spend is on the record, no cap enforced.");
    process.exit(0);
  }

  console.log("");
  console.log("Budget");
  console.log("------");
  const breaches = [];

  if (budget.usd !== undefined) {
    const flag = totals.usd_estimate > budget.usd;
    const pct = budget.usd === 0 ? "over" : `${((totals.usd_estimate / budget.usd) * 100).toFixed(0)}%`;
    console.log(
      `  usd            ${fmtUsd(totals.usd_estimate)} / ${fmtUsd(budget.usd)}  ` +
        `(${pct})${flag ? "  OVER" : ""}`
    );
    if (flag) {
      breaches.push(
        `usd spend ${fmtUsd(totals.usd_estimate)} exceeds cap ${fmtUsd(budget.usd)}`
      );
    }
  }

  if (budget.output_tokens !== undefined) {
    const flag = totals.output_tokens > budget.output_tokens;
    const pct =
      budget.output_tokens === 0
        ? "over"
        : `${((totals.output_tokens / budget.output_tokens) * 100).toFixed(0)}%`;
    console.log(
      `  output_tokens  ${fmtInt(totals.output_tokens)} / ${fmtInt(budget.output_tokens)}  ` +
        `(${pct})${flag ? "  OVER" : ""}`
    );
    if (flag) {
      breaches.push(
        `output_tokens ${fmtInt(totals.output_tokens)} exceeds cap ${fmtInt(
          budget.output_tokens
        )}`
      );
    }
  }

  if (breaches.length) {
    console.error("");
    console.error("loop-budget: BUDGET EXCEEDED");
    for (const b of breaches) console.error(`  - ${b}`);
    process.exit(1);
  }

  console.log("");
  console.log("  within budget.");
  process.exit(0);
}

main();
