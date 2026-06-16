#!/usr/bin/env node
// loop-triage — dependency-free human-attention filter over Evidence Reports.
// The packaged, mechanical twin of skills/loop-triage/SKILL.md: same routing
// rules, but deterministic and runnable from a hook or automation with no agent.
//
// Usage: node scripts/triage.mjs [dir-or-files...]   (default: .loop/runs)
// It READS; it never writes. Exit 0 always (it routes attention, it does not
// gate). Exit 2 only if the default reports dir is missing.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";

const RUNS_DEFAULT = ".loop/runs";

function collectFiles(args) {
  if (args.length === 0) {
    let entries;
    try {
      entries = readdirSync(RUNS_DEFAULT);
    } catch {
      return { files: [], dirMissing: true };
    }
    return {
      files: entries.filter((f) => f.endsWith(".md")).sort().map((f) => join(RUNS_DEFAULT, f)),
      dirMissing: false,
    };
  }
  const files = [];
  for (const a of args) {
    const p = isAbsolute(a) ? a : resolve(a);
    let st;
    try {
      st = statSync(p);
    } catch {
      files.push(a); // keep it so it surfaces as unparseable
      continue;
    }
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) if (f.endsWith(".md")) files.push(join(a, f));
    } else files.push(a);
  }
  return { files: files.sort(), dirMissing: false };
}

// Minimal, dependency-free read of just the frontmatter fields triage needs.
// Intentionally a strict subset — it fails loud (unparseable) rather than guess.
function frontmatter(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if ((lines[0] || "").trim() !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  return lines.slice(1, end);
}

const strip = (s) => s.trim().replace(/^["']|["']$/g, "");

function scalar(fm, key) {
  const re = new RegExp("^" + key + ":\\s*(.*)$");
  for (const l of fm) {
    const m = l.match(re);
    if (m) return strip(m[1]);
  }
  return "";
}

function nested(fm, parent, key) {
  let inParent = false;
  for (const l of fm) {
    if (/^\S/.test(l)) inParent = l.startsWith(parent + ":");
    else if (inParent) {
      const m = l.match(new RegExp("^\\s+" + key + ":\\s*(.*)$"));
      if (m) return strip(m[1]);
    }
  }
  return "";
}

// Robust to `needs_human: []`, `needs_human:  [ ]`, and block lists of `- ` items.
function listItems(fm, key) {
  for (let i = 0; i < fm.length; i++) {
    const m = fm[i].match(new RegExp("^" + key + ":\\s*(.*)$"));
    if (!m) continue;
    const rest = m[1].trim().replace(/\s+/g, "");
    if (rest === "[]") return [];
    if (rest !== "") return []; // inline non-list scalar — treat as empty
    const items = [];
    for (let j = i + 1; j < fm.length; j++) {
      if (/^\s+-\s+/.test(fm[j])) items.push(strip(fm[j].replace(/^\s+-\s+/, "")));
      else if (/^\S/.test(fm[j])) break; // next top-level key ends the block
    }
    return items;
  }
  return [];
}

const { files, dirMissing } = collectFiles(process.argv.slice(2));
if (dirMissing) {
  console.error(`loop-triage: ${RUNS_DEFAULT} not found. Pass a dir or report paths.`);
  process.exit(2);
}
if (files.length === 0) {
  console.log("loop-triage: no Evidence Reports found.");
  process.exit(0);
}

const reports = [];
const unparseable = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    unparseable.push({ f, why: "cannot read" });
    continue;
  }
  const fm = frontmatter(text);
  if (!fm) {
    unparseable.push({ f, why: "no frontmatter" });
    continue;
  }
  const version = scalar(fm, "loop_trust_kit");
  if (version !== "1") {
    unparseable.push({ f, why: `loop_trust_kit version ${version || "?"}` });
    continue;
  }
  reports.push({
    f,
    run_id: scalar(fm, "run_id") || f,
    task: scalar(fm, "task"),
    status: scalar(fm, "status"),
    risk: scalar(fm, "risk"),
    verdict: nested(fm, "checker", "verdict"),
    needs_human: listItems(fm, "needs_human"),
  });
}

const RANK = { high: 0, medium: 1, low: 2, "": 3 };
const needsReview = (r) =>
  r.risk === "medium" ||
  r.risk === "high" ||
  r.status !== "done" ||
  r.verdict === "refuted" ||
  r.verdict === "unverifiable" ||
  r.needs_human.length > 0;

const acts = reports.flatMap((r) => r.needs_human.map((ask) => ({ run_id: r.run_id, ask })));
const notDone = reports.filter((r) => r.status !== "done");
const reviewList = reports.filter(needsReview).sort((a, b) => {
  if (RANK[a.risk] !== RANK[b.risk]) return RANK[a.risk] - RANK[b.risk];
  const fa = a.status === "failed" || a.status === "needs-human" ? 0 : 1;
  const fb = b.status === "failed" || b.status === "needs-human" ? 0 : 1;
  return fa - fb;
});
const skips = reports.filter((r) => !needsReview(r));

const out = [];
out.push(`# Loop triage — ${reports.length} report${reports.length === 1 ? "" : "s"}`, "");

out.push(`## Act first — needs_human (${acts.length})`);
if (acts.length === 0) out.push("None. No human decision is blocking.");
else for (const a of acts) out.push(`- [${a.run_id}] ${a.ask}`);
out.push("");

out.push(`## Not done (${notDone.length})`);
if (notDone.length === 0) out.push("All reports are status: done.");
else {
  out.push("| run_id | status | verdict | risk | task |", "|---|---|---|---|---|");
  for (const r of notDone) out.push(`| ${r.run_id} | ${r.status} | ${r.verdict || "-"} | ${r.risk} | ${r.task} |`);
}
out.push("");

out.push(`## Review order (risk high → low) — ${reviewList.length}`);
if (reviewList.length === 0) out.push("Nothing needs review.");
else reviewList.forEach((r, i) => out.push(`${i + 1}. **[${r.risk || "?"}]** ${r.run_id} — ${r.task} — ${r.verdict || "n/a"}`));
out.push("");

out.push(`## Skip — safe to not read (${skips.length})`);
if (skips.length === 0) out.push("Nothing safe to skip; read everything above.");
else for (const r of skips) out.push(`- [${r.run_id}] ${r.task} — risk low, done, nothing for you.`);

if (unparseable.length) {
  out.push("", `## Unparseable (${unparseable.length})`);
  for (const u of unparseable) out.push(`- ${u.f} — ${u.why}`);
}

out.push("", `— Read ${reviewList.length}, skip ${skips.length}${unparseable.length ? `, ${unparseable.length} unparseable` : ""}.`);
console.log(out.join("\n"));
process.exit(0);
