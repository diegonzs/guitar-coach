#!/usr/bin/env bun
/**
 * Writes data/reports/latest.md + data/progress.json and prints the report.
 *   bun run report [--days 14] [--quiet]
 */
import { loadCurriculum } from "@guitar-coach/core/node";
import { loadConfig } from "./config.ts";
import { Store } from "./store.ts";
import { writeReport } from "./report-lib.ts";

const args = process.argv.slice(2);
const daysIdx = args.indexOf("--days");
const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 14;
const cfg = loadConfig();
const store = new Store(cfg.dataDir);
await store.init();
const curriculum = await loadCurriculum(cfg.curriculumDir);
const { md, json, markdown } = await writeReport(store, curriculum, cfg.curriculumDir, { days });
if (!args.includes("--quiet")) console.log(markdown);
console.error(`→ ${md}\n→ ${json}`);
