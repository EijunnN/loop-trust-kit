#!/usr/bin/env node
// validate-report.mjs — dependency-free validator for Evidence Reports (format v1).
//
// Runs with plain `node scripts/validate-report.mjs`. No npm install, no packages.
// Default target: .loop/runs/*.md. Pass file paths as arguments to override.
//
// It parses the YAML frontmatter (a minimal YAML subset — enough for the schema
// in SPEC.md) and enforces the rules that make the format mean something. One
// non-zero exit if any report fails. The contract lives in SPEC.md; this is its
// teeth.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';

const DEFAULT_DIR = '.loop/runs';

// ---------------------------------------------------------------------------
// Minimal YAML-subset parser.
//
// Supports exactly what the Evidence Report schema needs and nothing more:
//   - scalars (bare, single-quoted, double-quoted, integers, floats)
//   - nested maps (indentation-based)
//   - lists of scalars   (- value)
//   - lists of maps       (- key: value  + following indented keys)
//   - block scalars       (key: |  ... indented lines ...)
//   - line comments       (# ...) outside of quotes/block scalars
//
// It is intentionally strict-ish and throws on shapes it does not understand,
// so a malformed report fails loudly rather than parsing into garbage.
// ---------------------------------------------------------------------------

function stripComment(line) {
  // Remove a trailing `# ...` comment that is not inside a quoted string.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      // A comment must be preceded by whitespace or start the content.
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return null;
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  // Inline (flow-style) empty collections — the only flow style the schema uses,
  // e.g. `needs_human: []` for "walk away".
  if (s === '[]' || /^\[\s*\]$/.test(s)) return [];
  if (s === '{}' || /^\{\s*\}$/.test(s)) return {};
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)(e[+-]?\d+)?$/i.test(s) && /[.e]/i.test(s)) {
    return parseFloat(s);
  }
  return s;
}

function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

// Parse a block of lines at a given indentation into a JS value.
// `lines` is an array of { indent, content, raw } for non-blank, non-comment lines,
// pre-split with block scalars already collapsed into their owning key line.
function parseBlock(lines, start, end, baseIndent) {
  // Decide: list or map? Look at the first significant line at baseIndent.
  let i = start;
  while (i < end && lines[i].indent < baseIndent) i++;
  if (i >= end) return null;

  const isList = lines[i].content.startsWith('- ') || lines[i].content === '-';

  if (isList) return parseList(lines, start, end, baseIndent);
  return parseMap(lines, start, end, baseIndent);
}

function parseMap(lines, start, end, baseIndent) {
  const obj = {};
  let i = start;
  while (i < end) {
    const ln = lines[i];
    if (ln.indent < baseIndent) break;
    if (ln.indent > baseIndent) {
      throw new Error(`unexpected indentation at line ${ln.lineNo}: "${ln.raw}"`);
    }
    const content = ln.content;
    const colon = findKeyColon(content);
    if (colon === -1) {
      throw new Error(`expected "key: value" at line ${ln.lineNo}: "${ln.raw}"`);
    }
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).trim();

    if (ln.block !== undefined) {
      // Block scalar attached to this key.
      obj[key] = ln.block;
      i++;
      continue;
    }

    if (rest === '') {
      // Nested structure on following deeper-indented lines.
      const childStart = i + 1;
      let childEnd = childStart;
      while (childEnd < end && lines[childEnd].indent > baseIndent) childEnd++;
      if (childEnd === childStart) {
        // Nothing nested → empty value.
        obj[key] = null;
        i++;
      } else {
        const childIndent = lines[childStart].indent;
        obj[key] = parseBlock(lines, childStart, childEnd, childIndent);
        i = childEnd;
      }
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }
  return obj;
}

function parseList(lines, start, end, baseIndent) {
  const arr = [];
  let i = start;
  while (i < end) {
    const ln = lines[i];
    if (ln.indent < baseIndent) break;
    if (ln.indent > baseIndent) {
      throw new Error(`unexpected indentation at line ${ln.lineNo}: "${ln.raw}"`);
    }
    if (!(ln.content === '-' || ln.content.startsWith('- '))) {
      throw new Error(`expected list item "- ..." at line ${ln.lineNo}: "${ln.raw}"`);
    }
    const afterDash = ln.content === '-' ? '' : ln.content.slice(2);
    const colon = findKeyColon(afterDash);

    if (colon !== -1) {
      // List of maps: first key sits on the dash line; the dash counts as 2 cols
      // of indent for sibling keys of this item.
      const itemIndent = baseIndent + 2;
      // Build a synthetic line for the inline first key, then gather the rest.
      const synthetic = {
        indent: itemIndent,
        content: afterDash,
        raw: ln.raw,
        lineNo: ln.lineNo,
        block: ln.block,
      };
      const itemLines = [synthetic];
      let j = i + 1;
      while (j < end && lines[j].indent >= itemIndent && !isDashAt(lines[j], baseIndent)) {
        itemLines.push(lines[j]);
        j++;
      }
      arr.push(parseMap(itemLines, 0, itemLines.length, itemIndent));
      i = j;
    } else if (afterDash.trim() === '') {
      // Bare dash → nested block on following deeper lines.
      const childStart = i + 1;
      let childEnd = childStart;
      while (childEnd < end && lines[childEnd].indent > baseIndent) childEnd++;
      if (childEnd === childStart) {
        arr.push(null);
        i++;
      } else {
        const childIndent = lines[childStart].indent;
        arr.push(parseBlock(lines, childStart, childEnd, childIndent));
        i = childEnd;
      }
    } else {
      // List of scalars.
      arr.push(parseScalar(afterDash));
      i++;
    }
  }
  return arr;
}

function isDashAt(ln, indent) {
  return ln.indent === indent && (ln.content === '-' || ln.content.startsWith('- '));
}

// Find the colon that separates a map key from its value. The key must be a
// plain (optionally quoted) token; we ignore colons inside quotes.
function findKeyColon(content) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) {
      // YAML requires the colon be followed by whitespace or end-of-line.
      if (i + 1 >= content.length || content[i + 1] === ' ') return i;
    }
  }
  return -1;
}

// Pre-pass: turn the raw frontmatter text into a flat list of significant lines,
// collapsing block scalars (`|`) into the `block` field of their owning key/dash.
function tokenize(text) {
  const rawLines = text.split('\n');
  const out = [];
  for (let idx = 0; idx < rawLines.length; idx++) {
    const rawLine = rawLines[idx].replace(/\r$/, '');
    const lineNo = idx + 1;

    // Skip blank lines.
    if (rawLine.trim() === '') continue;

    const indent = indentOf(rawLine);
    let content = rawLine.slice(indent);

    // Whole-line comment.
    if (content.startsWith('#')) continue;

    // Detect a block scalar marker `|` at end of `key: |` or `- key: |`.
    const stripped = stripComment(content).replace(/\s+$/, '');
    const blockMatch = stripped.match(/^(.*?:)\s*\|([+-]?)\s*$/);
    if (blockMatch) {
      const keyPart = blockMatch[1];
      // Gather all following lines more-indented than this key as the block body.
      const bodyLines = [];
      let j = idx + 1;
      // The block body is everything indented deeper than `indent` (blank lines
      // included, until a line at <= indent that is non-blank).
      while (j < rawLines.length) {
        const bl = rawLines[j].replace(/\r$/, '');
        if (bl.trim() === '') {
          bodyLines.push('');
          j++;
          continue;
        }
        if (indentOf(bl) > indent) {
          bodyLines.push(bl);
          j++;
        } else break;
      }
      // De-indent by the minimum indentation among non-blank body lines.
      const indents = bodyLines.filter((l) => l.trim() !== '').map(indentOf);
      const minIndent = indents.length ? Math.min(...indents) : 0;
      let body = bodyLines
        .map((l) => (l.trim() === '' ? '' : l.slice(minIndent)))
        .join('\n')
        .replace(/\n+$/, '');
      out.push({ indent, content: keyPart, raw: rawLine, lineNo, block: body });
      idx = j - 1;
      continue;
    }

    content = stripComment(content).replace(/\s+$/, '');
    if (content.trim() === '') continue;
    out.push({ indent, content, raw: rawLine, lineNo });
  }
  return out;
}

function parseYaml(text) {
  const lines = tokenize(text);
  if (lines.length === 0) return {};
  const baseIndent = lines[0].indent;
  return parseBlock(lines, 0, lines.length, baseIndent);
}

// ---------------------------------------------------------------------------
// Frontmatter extraction.
// ---------------------------------------------------------------------------

function extractFrontmatter(file, source) {
  const text = source.replace(/^﻿/, '');
  const lines = text.split('\n');
  // First non-blank line must be `---`.
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length || lines[i].trim() !== '---') {
    throw new Error('no YAML frontmatter (file must start with a "---" line)');
  }
  const start = i + 1;
  let end = -1;
  for (let j = start; j < lines.length; j++) {
    if (lines[j].trim() === '---') {
      end = j;
      break;
    }
  }
  if (end === -1) throw new Error('unterminated frontmatter (missing closing "---")');
  return lines.slice(start, end).join('\n');
}

// ---------------------------------------------------------------------------
// SPEC rules.
// ---------------------------------------------------------------------------

const STATUSES = ['done', 'partial', 'failed', 'needs-human'];
const VERDICTS = ['confirmed', 'refuted', 'unverifiable'];
const METHODS = ['command', 'inspection', 'none'];
const RISKS = ['low', 'medium', 'high'];

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validate(fm) {
  const errors = [];
  const E = (msg) => errors.push(msg);

  if (!isObject(fm)) {
    E('frontmatter did not parse into a map');
    return errors;
  }

  // Version gate — refuse what we do not understand.
  if (!('loop_trust_kit' in fm)) {
    E('missing required field: loop_trust_kit');
  } else if (fm.loop_trust_kit !== 1) {
    E(`loop_trust_kit must equal 1, got ${JSON.stringify(fm.loop_trust_kit)}`);
  }

  // Required top-level fields.
  for (const key of [
    'run_id',
    'task',
    'status',
    'maker',
    'checker',
    'changes',
    'evidence',
    'unverified',
    'risk',
  ]) {
    if (!(key in fm) || fm[key] === null || fm[key] === undefined) {
      E(`missing required field: ${key}`);
    }
  }

  // status enum.
  if ('status' in fm && !STATUSES.includes(fm.status)) {
    E(`status must be one of ${STATUSES.join('/')}, got ${JSON.stringify(fm.status)}`);
  }

  // maker / checker maps and the maker != checker rule.
  const maker = fm.maker;
  const checker = fm.checker;
  if (maker != null && !isObject(maker)) E('maker must be a map');
  if (checker != null && !isObject(checker)) E('checker must be a map');

  if (isObject(maker) && (maker.agent == null || maker.agent === '')) {
    E('maker.agent is required');
  }
  if (isObject(checker) && (checker.agent == null || checker.agent === '')) {
    E('checker.agent is required');
  }
  if (
    isObject(maker) &&
    isObject(checker) &&
    maker.agent != null &&
    checker.agent != null &&
    String(maker.agent) === String(checker.agent)
  ) {
    E(`maker.agent must differ from checker.agent (both are "${maker.agent}") — self-grading`);
  }

  // checker.verdict enum (when present).
  if (isObject(checker) && checker.verdict != null && !VERDICTS.includes(checker.verdict)) {
    E(`checker.verdict must be one of ${VERDICTS.join('/')}, got ${JSON.stringify(checker.verdict)}`);
  }

  // risk enum.
  if ('risk' in fm && fm.risk != null && !RISKS.includes(fm.risk)) {
    E(`risk must be one of ${RISKS.join('/')}, got ${JSON.stringify(fm.risk)}`);
  }

  // changes shape.
  if ('changes' in fm && fm.changes != null) {
    if (!Array.isArray(fm.changes)) E('changes must be a list');
    else {
      fm.changes.forEach((c, k) => {
        if (!isObject(c)) E(`changes[${k}] must be a map`);
        else if (c.path == null || c.path === '') E(`changes[${k}].path is required`);
      });
    }
  }

  // evidence shape + per-entry rules.
  const evidence = fm.evidence;
  const isDone = fm.status === 'done';
  if ('evidence' in fm && evidence != null) {
    if (!Array.isArray(evidence)) {
      E('evidence must be a list');
    } else {
      evidence.forEach((e, k) => {
        if (!isObject(e)) {
          E(`evidence[${k}] must be a map`);
          return;
        }
        if (e.claim == null || e.claim === '') E(`evidence[${k}].claim is required`);
        if (e.method == null || e.method === '') {
          E(`evidence[${k}].method is required`);
        } else if (!METHODS.includes(e.method)) {
          E(`evidence[${k}].method must be one of ${METHODS.join('/')}, got ${JSON.stringify(e.method)}`);
        }

        // No naked claims on a done report.
        if (isDone && e.method === 'none') {
          E(`evidence[${k}] has method 'none' on a 'done' report — a naked claim; move it to unverified`);
        }

        // verified_by: checker requires a command and an integer exit_code.
        if (e.verified_by === 'checker') {
          if (e.command == null || String(e.command).trim() === '') {
            E(`evidence[${k}] is verified_by checker but has no command`);
          }
          if (!Number.isInteger(e.exit_code)) {
            E(`evidence[${k}] is verified_by checker but exit_code is not an integer (got ${JSON.stringify(e.exit_code)})`);
          }
        }
      });
    }
  }

  // unverified honesty rule on a done report.
  if ('unverified' in fm && fm.unverified != null && !Array.isArray(fm.unverified)) {
    E('unverified must be a list');
  }
  if (isDone) {
    const u = fm.unverified;
    const nonEmpty = Array.isArray(u) && u.filter((x) => x != null && String(x).trim() !== '').length > 0;
    if (!nonEmpty) {
      // Allow an explicit justification note instead of entries.
      const note =
        fm.unverified_justification ??
        (isObject(fm.unverified) ? fm.unverified.justification : undefined);
      if (note == null || String(note).trim() === '') {
        E(
          "status is 'done' but 'unverified' is empty and carries no justification — " +
            '"nothing unverified" is itself a strong claim (SPEC rule 4)'
        );
      }
    }
  }

  // needs_human, when present, must be a list.
  if ('needs_human' in fm && fm.needs_human != null && !Array.isArray(fm.needs_human)) {
    E('needs_human must be a list');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// File discovery + driver.
// ---------------------------------------------------------------------------

function resolveTargets(args) {
  if (args.length > 0) {
    return args.map((a) => (isAbsolute(a) ? a : resolve(process.cwd(), a)));
  }
  let entries;
  try {
    entries = readdirSync(DEFAULT_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(DEFAULT_DIR, f));
}

function main() {
  const args = process.argv.slice(2);
  const targets = resolveTargets(args);

  if (targets.length === 0) {
    console.error(`No Evidence Reports found (looked in ${DEFAULT_DIR}/*.md). Pass paths to override.`);
    process.exit(2);
  }

  let failed = 0;
  for (const file of targets) {
    let source;
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error('not a file');
      source = readFileSync(file, 'utf8');
    } catch (err) {
      failed++;
      console.log(`FAIL  ${file}`);
      console.log(`        - cannot read: ${err.message}`);
      continue;
    }

    let errors;
    try {
      const fmText = extractFrontmatter(file, source);
      const fm = parseYaml(fmText);
      errors = validate(fm);
    } catch (err) {
      errors = [`parse error: ${err.message}`];
    }

    if (errors.length === 0) {
      console.log(`PASS  ${file}`);
    } else {
      failed++;
      console.log(`FAIL  ${file}`);
      for (const e of errors) console.log(`        - ${e}`);
    }
  }

  const total = targets.length;
  const passed = total - failed;
  console.log('');
  console.log(`${passed}/${total} reports passed${failed ? `, ${failed} failed` : ''}.`);
  process.exit(failed ? 1 : 0);
}

main();
