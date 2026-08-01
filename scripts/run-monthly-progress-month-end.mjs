/**
 * 月末判定付き Monthly Progress ランナー
 *
 * 月末に2回起動する想定:
 *   14:00 --phase=persist … 全員分を生成してマイページ保存（送信しない）
 *   20:00 --phase=send    … 保存済みを LINE 一斉送信
 *
 * usage:
 *   node scripts/run-monthly-progress-month-end.mjs --phase=persist --confirm-send
 *   node scripts/run-monthly-progress-month-end.mjs --phase=send --confirm-send
 *   node scripts/run-monthly-progress-month-end.mjs --list-only
 *   node scripts/run-monthly-progress-month-end.mjs --force --month=2026-07 --phase=persist
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DateTime } from "luxon";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PREPARE = path.join(ROOT, "scripts", "prepare-and-send-monthly-progress.mjs");
const BATCH = path.join(ROOT, "scripts", "send-monthly-progress-batch.mjs");
const TZ = "Asia/Tokyo";

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function resolvePhase(now) {
  const explicit = (arg("phase", null) || "").toLowerCase();
  if (explicit === "persist" || explicit === "send" || explicit === "all") return explicit;
  // LaunchAgent が時刻だけで起動する場合の自動判定
  return now.hour < 20 ? "persist" : "send";
}

function main() {
  const now = DateTime.now().setZone(TZ);
  const force = process.argv.includes("--force");
  const listOnly = process.argv.includes("--list-only");
  const isMonthEnd = now.day === now.endOf("month").day;
  const yearMonth = arg("month", null) || now.toFormat("yyyy-MM");
  const audience = arg("audience", "active-line") || "active-line";
  const phase = resolvePhase(now);

  const logDir = path.join(ROOT, "tmp", "monthly-progress-reports");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `_month-end-runner-${now.toFormat("yyyyMMdd-HHmmss")}.log`);

  const header = {
    now: now.toISO(),
    isMonthEnd,
    force,
    yearMonth,
    audience,
    phase,
    mode: listOnly ? "list-only" : phase,
  };
  console.log(JSON.stringify(header, null, 2));
  fs.writeFileSync(logPath, JSON.stringify(header, null, 2) + "\n");

  if (!isMonthEnd && !force) {
    const msg = "skip: today is not month-end (use --force to override)";
    console.log(msg);
    fs.appendFileSync(logPath, msg + "\n");
    return;
  }

  if (listOnly) {
    const args = [BATCH, `--month=${yearMonth}`, `--audience=${audience}`, "--list-only"];
    console.log("spawn", process.execPath, args.join(" "));
    const r = spawnSync(process.execPath, args, {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
    });
    fs.appendFileSync(logPath, (r.stdout || "") + "\n" + (r.stderr || "") + "\n");
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.status ?? 1);
  }

  const passthrough = process.argv.slice(2).filter((a) => {
    if (a === "--force") return false;
    if (a.startsWith("--month=")) return false;
    if (a.startsWith("--audience=")) return false;
    if (a.startsWith("--send-after=")) return false;
    if (a.startsWith("--phase=")) return false;
    return true;
  });

  const args = [PREPARE, `--month=${yearMonth}`, `--phase=${phase}`, ...passthrough];
  // persist では待たない。send/all で 20:00 待ちが必要なら prepare 側で扱う
  if (phase === "all") args.push("--send-after=20:00");

  console.log("spawn", process.execPath, args.join(" "));
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  fs.appendFileSync(logPath, (r.stdout || "") + "\n" + (r.stderr || "") + "\n");
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}

main();
