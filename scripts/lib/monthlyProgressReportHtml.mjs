const GOLD = "#B98A2E";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stars(n) {
  return Array.from({ length: 5 }, (_, i) => (i < n ? "★" : "☆")).join("");
}

function header(report, title, subtitle) {
  return `<header class="hdr">
    <div class="brand">ABODY PERSONAL GYM</div>
    <div class="hdr-mid">
      <div class="ym">${esc(report.meta.yearMonthLabel)}</div>
      <h1>${esc(title)}</h1>
      ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}
    </div>
    <div class="hdr-right">
      <div class="name">${esc(report.member.name)} 様</div>
      <div class="pill">Abody歴 ${esc(report.member.tenureMonths)}ヶ月</div>
    </div>
  </header>`;
}

function donutSvg(ratios) {
  const colors = [GOLD, "#8A8A8A", "#C4C4C4", "#6B6B6B", "#D9D2C5", "#4A4A4A"];
  const total = ratios.reduce((a, b) => a + b.pct, 0) || 1;
  const r = 54;
  const cx = 70;
  const cy = 70;
  const stroke = 18;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = ratios
    .map((p, i) => {
      const len = (p.pct / total) * C;
      const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="${stroke}"
        stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += len;
      return circle;
    })
    .join("");
  const sum = ratios.reduce((a, b) => a + b.count, 0);
  return `<svg width="140" height="140" viewBox="0 0 140 140">${arcs}
    <circle cx="${cx}" cy="${cy}" r="${r - stroke / 2 - 2}" fill="#fff"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="10" fill="#6B7280">Total</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="16" font-weight="700" fill="#1A1A1A">${sum}</text>
  </svg>`;
}

function calendarHtml(yearMonth, visitDates) {
  const [y, m] = yearMonth.split("-").map(Number);
  const firstDow = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const set = new Set(visitDates);
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const head = ["日", "月", "火", "水", "木", "金", "土"].map((d) => `<div class="c-h">${d}</div>`).join("");
  const body = cells
    .map((d) => {
      if (!d) return `<div></div>`;
      const ymd = `${yearMonth}-${String(d).padStart(2, "0")}`;
      return `<div class="c-d ${set.has(ymd) ? "on" : ""}">${d}</div>`;
    })
    .join("");
  return `<div class="cal">${head}${body}</div><p class="muted">今月は ${visitDates.length} 日来店しました</p>`;
}

function sparkline(values, color = GOLD) {
  const w = 220;
  const h = 72;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * (w - 8) + 4;
      const y = h - 6 - ((v - min) / span) * (h - 14);
      return `${x},${y}`;
    })
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="3" points="${pts}"/></svg>`;
}

function page1(report) {
  const { ai, photos } = report;
  let topSection = "";
  const hasPhotos = Boolean(photos?.hasAny || photos?.hasComparison || photos?.hasTimeline || photos?.record);
  const timeline = [photos?.oldest, photos?.previous, photos?.current].filter(Boolean);
  const canShowTimeline = timeline.length >= 2 || (photos?.oldest && (photos?.previous || photos?.current));

  if (canShowTimeline && (photos.oldest || photos.previous || photos.current)) {
    topSection = photoTimelineHtml(photos.oldest, photos.previous, photos.current);
  } else if (photos.hasComparison && photos.before && photos.after) {
    topSection = photoTimelineHtml(photos.before, null, photos.after);
  } else if (photos.record) {
    topSection = photoRecordHtml(photos.record);
  } else {
    topSection = photoUnavailableHtml();
  }

  const postureBlock =
    hasPhotos && ai.postureItems?.length > 0
      ? `<section class="card posture-card">
          <h3>AI姿勢分析（体型写真ベース）</h3>
          <div class="posture-grid">
            ${ai.postureItems
              .map(
                (item) => `<div class="posture-item">
              <div class="muted">${esc(item.label)}</div>
              <div class="stars">${stars(item.stars)}</div>
              <div class="gold posture-sum">${esc(item.summary)}</div>
              <p class="muted posture-detail">${esc(item.detail)}</p>
            </div>`
              )
              .join("")}
          </div>
        </section>`
      : `<section class="card posture-card posture-unavailable">
            <h3>AI姿勢分析（体型写真ベース）</h3>
            <div class="unavailable-box">${hasPhotos ? "姿勢分析データを準備中です" : "体型写真なしのため分析不可"}</div>
          </section>`;

  const muscleBlock =
    hasPhotos && (ai.weakMuscles?.length || ai.stiffMuscles?.length)
      ? `<div class="grid2 muscle-grid">
          <section class="card">
            <h3>弱い筋肉（強化したい）</h3>
            ${(ai.weakMuscles || [])
              .map((m) => `<div class="muscle"><div class="ach-t">${esc(m.name)}</div><div class="muted">${esc(m.reason)}</div></div>`)
              .join("")}
          </section>
          <section class="card">
            <h3>硬い筋肉（ほぐしたい）</h3>
            ${(ai.stiffMuscles || [])
              .map((m) => `<div class="muscle"><div class="ach-t">${esc(m.name)}</div><div class="muted">${esc(m.reason)}</div></div>`)
              .join("")}
          </section>
        </div>`
      : `<div class="grid2 muscle-grid">
            <section class="card">
              <h3>弱い筋肉（強化したい）</h3>
              <div class="unavailable-box">${hasPhotos ? "分析データを準備中です" : "体型写真なしのため分析不可"}</div>
            </section>
            <section class="card">
              <h3>硬い筋肉（ほぐしたい）</h3>
              <div class="unavailable-box">${hasPhotos ? "分析データを準備中です" : "体型写真なしのため分析不可"}</div>
            </section>
          </div>`;

  return `<section class="page page1">
    ${header(report, "あなたの成長レポート", "MONTHLY PROGRESS REPORT")}
    ${topSection}
    ${postureBlock}
    ${muscleBlock}
    <footer class="foot">小さな積み重ねが、大きな変化につながります。</footer>
  </section>`;
}

function photoUnavailableHtml() {
  return `<section class="card ba-card ba-unavailable">
    <h3>体型比較</h3>
    <div class="ba-empty-panel">
      <div class="ba-empty-slots">
        ${["正面", "側面", "背面"]
          .map(
            (label) => `<div class="ba-empty-slot">
          <div class="photo-empty tall"></div>
          <div class="ba-cap">${esc(label)}</div>
        </div>`
          )
          .join("")}
      </div>
      <div class="unavailable-msg">体型写真なしのため分析不可</div>
    </div>
  </section>`;
}

/** 最古 / 先月 / 今月 の3時点比較 */
function photoTimelineHtml(oldest, previous, current) {
  const cols = [
    { set: oldest, role: "最古", fallback: "最古" },
    { set: previous, role: "先月", fallback: "先月" },
    { set: current, role: "今月", fallback: "今月" },
  ];
  const rows = [
    { key: "frontUrl", label: "正面" },
    { key: "sideUrl", label: "側面" },
    { key: "backUrl", label: "背面" },
  ];
  const legend = cols
    .map((c) => {
      if (!c.set) return `${c.fallback}：—`;
      return `${c.role}（${c.set.label}）`;
    })
    .join("　／　");

  return `<section class="card ba-card">
    <h3>体型比較</h3>
    <p class="ba-legend">${esc(legend)}</p>
    <div class="ba-rows">
      ${rows
        .map((r) => {
          const shots = cols
            .map((c, idx) => {
              const url = c.set?.angles?.[r.key] || null;
              const cap = c.set ? `${c.role}` : c.fallback;
              const arrow =
                idx < cols.length - 1
                  ? `<div class="ba-arrow">→</div>`
                  : "";
              return `<div class="ba-shot">
                ${url ? `<img src="${esc(url)}" alt="${esc(r.label)} ${esc(cap)}" />` : `<div class="photo-empty">未登録</div>`}
                <div class="ba-cap">${esc(cap)}${c.set ? `<span class="ba-cap-sub">${esc(c.set.label)}</span>` : ""}</div>
              </div>${arrow}`;
            })
            .join("");
          return `<div class="ba-row">
            <div class="ba-angle">${esc(r.label)}</div>
            <div class="ba-triple">${shots}</div>
          </div>`;
        })
        .join("")}
    </div>
  </section>`;
}

function photoComparisonHtml(before, after) {
  return photoTimelineHtml(before, null, after);
}

function photoAnglesHtml(set, title) {
  const slots = [
    { label: "正面", url: set.angles.frontUrl },
    { label: "側面", url: set.angles.sideUrl },
    { label: "背面", url: set.angles.backUrl },
  ];
  return `<div class="photo-group">
    <div class="photo-title">${esc(title)}</div>
    <div class="photo-row">
      ${slots
        .map(
          (s) => `<div class="photo-cell">
        ${s.url ? `<img src="${esc(s.url)}" alt="${esc(s.label)}" />` : `<div class="photo-empty">${esc(s.label)}</div>`}
        <div class="photo-cap">${esc(s.label)}</div>
      </div>`
        )
        .join("")}
    </div>
  </div>`;
}

function photoRecordHtml(record) {
  return `<section class="card">
    <h3>体型写真</h3>
    <p class="muted" style="margin-bottom:8px">記録日 ${esc(record.label)}（比較用の現在写真は未登録のため、この写真で姿勢分析）</p>
    ${photoAnglesHtml(record, `体型記録（${record.label}）`)}
  </section>`;
}

function page2(report) {
  const { metrics, ai, partRatios, visitDates, meta, trainerFeedbacks } = report;
  const metricsHtml = [
    ["来店回数", `${metrics.visitCount}`, "回"],
    ["総運動時間", `${metrics.totalMinutes}`, "分"],
    ["消費カロリー(目安)", `${metrics.estimatedKcal.toLocaleString()}`, "kcal"],
    ["累計来店", `${metrics.cumulativeVisits}`, "回"],
    ["平均満足度", metrics.avgSatisfaction ?? "—", metrics.avgSatisfaction != null ? "/5" : ""],
    ["アンケート回答率", metrics.surveyResponseRate ?? "—", metrics.surveyResponseRate != null ? "%" : ""],
    ["予約達成率", metrics.bookingAchievementRate ?? "—", "%"],
    ["総合評価", metrics.overallGrade, ""],
  ]
    .map(
      ([l, v, u]) =>
        `<div class="metric"><div class="muted">${esc(l)}</div><div class="metric-v">${esc(v)}<span>${esc(u)}</span></div></div>`
    )
    .join("");

  const legend = partRatios
    .map((p, i) => {
      const colors = [GOLD, "#8A8A8A", "#C4C4C4", "#6B6B6B", "#D9D2C5", "#4A4A4A"];
      return `<div class="leg"><span class="dot" style="background:${colors[i % colors.length]}"></span>${esc(p.part)} <b>${p.pct}%</b></div>`;
    })
    .join("");

  const achievements = ai.achievements
    .map((a) => `<div class="ach"><div class="ach-t">${esc(a.title)}</div><div class="muted">${esc(a.detail)}</div></div>`)
    .join("");

  const feedbacks = trainerFeedbacks || [];
  const feedbackBlock =
    feedbacks.length > 0
      ? `<section class="card fb-section">
          <h3>今月のトレーナーからのフィードバック</h3>
          <div class="fb-list">
            ${feedbacks
              .map(
                (f) => `<div class="fb-item">
              <div class="fb-head">
                <span class="avatar sm">${esc((f.trainerName || "ト").slice(0, 1))}</span>
                <div>
                  <div class="ach-t">トレーナー ${esc(f.trainerName)} からのフィードバック</div>
                  <div class="muted">${esc(f.dateLabel || f.date || "")}</div>
                </div>
              </div>
              <p class="body">${esc(f.text)}</p>
            </div>`
              )
              .join("")}
          </div>
        </section>`
      : `<section class="card fb-section">
          <h3>今月のトレーナーからのフィードバック</h3>
          <p class="muted">今月のフィードバック抜粋はまだありません。</p>
        </section>`;

  return `<section class="page page2">
    ${header(report, `${meta.yearMonthLabel}の成果サマリー`, "RESULTS SUMMARY")}
    <section class="card score-hero">
      <div class="score-hero-left">
        <div class="muted gold">ABODY SCORE</div>
        <div class="score-hero-n">${esc(metrics.abodyScore)}</div>
        <div class="muted">/ 100</div>
        <div class="grade-inline">${esc(metrics.overallGrade)} Excellent</div>
      </div>
      <div class="score-hero-right">
        <div class="stars">${stars(Math.min(5, Math.round(metrics.abodyScore / 20)))}</div>
        <p class="body strong comment-body">${esc(ai.overallComment)}</p>
      </div>
      <div class="metrics score-metrics">${metricsHtml}</div>
    </section>
    <div class="grid2 page2-mid">
      <section class="card mid-card"><h3>来店履歴</h3>${calendarHtml(meta.yearMonth, visitDates)}</section>
      <section class="card mid-card"><h3>部位別トレーニング比率</h3><div class="pie-row">${donutSvg(partRatios)}<div>${legend}</div></div></section>
    </div>
    <section class="card ach-section"><h3>今月できたこと</h3><div class="ach-grid">${achievements}</div></section>
    ${feedbackBlock}
  </section>`;
}

function page3(report) {
  const { weightRows, ai, partRatios, topExercises, volumeTrend, trainer } = report;
  const rows = weightRows
    .slice(0, 6)
    .map((r) => {
      const vsPrev =
        r.vsPrev == null ? "—" : `${r.vsPrev > 0 ? "↗ +" : r.vsPrev < 0 ? "↘ " : ""}${r.vsPrev}kg`;
      return `<tr>
        <td>${esc(r.exercise)}</td>
        <td>${r.firstMax}kg</td>
        <td>${r.prevMonthMax != null ? `${r.prevMonthMax}kg` : "—"}</td>
        <td class="hi">${r.monthMax}kg</td>
        <td class="${r.vsPrev > 0 ? "up" : r.vsPrev < 0 ? "down" : ""}">${vsPrev}</td>
        <td class="${r.vsFirst > 0 ? "up" : r.vsFirst < 0 ? "down" : ""}">${r.vsFirst > 0 ? "+" : ""}${r.vsFirst}kg</td>
        <td class="${r.growthPct > 0 ? "up" : r.growthPct < 0 ? "down" : ""}">${r.growthPct > 0 ? "+" : ""}${r.growthPct}%</td>
      </tr>`;
    })
    .join("");

  const maxSets = Math.max(1, ...topExercises.map((t) => t.sets));
  const tops = topExercises
    .map(
      (t, i) =>
        `<div class="top"><div class="top-h"><span>${i + 1}. ${esc(t.exercise)}</span><span class="gold">${t.sets} sets</span></div><div class="bar"><i style="width:${Math.round((t.sets / maxSets) * 100)}%"></i></div></div>`
    )
    .join("");

  const legend = partRatios
    .map((p, i) => {
      const colors = [GOLD, "#8A8A8A", "#C4C4C4", "#6B6B6B", "#D9D2C5"];
      return `<div class="leg"><span class="dot" style="background:${colors[i % colors.length]}"></span>${esc(p.part)} <b>${p.pct}%</b></div>`;
    })
    .join("");

  const trends = [
    ["総重量", volumeTrend.map((d) => d.totalKg), "kg"],
    ["平均重量", volumeTrend.map((d) => d.avgKg), "kg"],
    ["セット数", volumeTrend.map((d) => d.sets), ""],
  ]
    .map(([t, vals]) => {
      const first = vals.find((v) => v > 0) || 0;
      const last = [...vals].reverse().find((v) => v > 0) || 0;
      const delta = Math.round((last - first) * 10) / 10;
      return `<div><div class="muted">${esc(t)}</div>${sparkline(vals)}<div class="gold">${delta >= 0 ? "+" : ""}${delta}</div></div>`;
    })
    .join("");

  return `<section class="page page3">
    ${header(report, "トレーニング分析レポート", "TRAINING ANALYSIS")}
    <section class="card">
      <h3>主要種目の重量推移</h3>
      <table>
        <thead><tr><th>種目</th><th>初回最高</th><th>先月最高</th><th>今月最高</th><th>先月比</th><th>初回比</th><th>伸び率</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <section class="card">
      <h3>AI分析</h3>
      <div class="facts">
        <div><div class="muted">一番伸びた種目</div><b>${esc(ai.analysis.mostImproved)}</b></div>
        <div><div class="muted">伸び悩み種目</div><b>${esc(ai.analysis.plateau)}</b></div>
        <div><div class="muted">重点部位</div><b>${esc(ai.analysis.focusPart)}</b></div>
        <div><div class="muted">得意部位</div><b>${esc(ai.analysis.strongPart)}</b></div>
        <div><div class="muted">課題部位</div><b>${esc(ai.analysis.challengePart)}</b></div>
      </div>
      <p class="body" style="margin-top:10px">${esc(ai.analysis.narrative)}</p>
    </section>
    <div class="grid2">
      <section class="card"><h3>部位別トレーニング比率</h3><div class="pie-row">${donutSvg(partRatios)}<div>${legend}</div></div></section>
      <section class="card"><h3>今月のTOP種目</h3>${tops}</section>
    </div>
    <div class="grid2 trend-highlight">
      <section class="card">
        <h3>トレーニングパフォーマンス推移</h3>
        <div class="trends">${trends}</div>
      </section>
      <section class="card">
        <h3>今月のハイライト</h3>
        <ul class="checks">${ai.achievements
          .slice(0, 5)
          .map((a) => `<li>✓ <b>${esc(a.title)}</b><div class="muted">${esc(a.detail)}</div></li>`)
          .join("")}</ul>
      </section>
    </div>
    <div class="grid2 comment-row">
      <section class="card comment-card">
        <h3>AIからの総評</h3>
        <div class="stars">${stars(5)}</div>
        <p class="body comment-body">${esc(ai.overallComment)}</p>
      </section>
      ${
        trainer && ai.trainerComment
          ? `<section class="card comment-card"><h3>トレーナーコメント</h3><p class="body comment-body">${esc(ai.trainerComment)}</p><div class="sig">${esc(trainer.displayName)}</div></section>`
          : `<section class="card comment-card"><h3>トレーナーコメント</h3><p class="muted">担当情報なし</p></section>`
      }
    </div>
  </section>`;
}

function page4(report) {
  const { ai, meta, trainer } = report;
  const goals = ai.goals
    .map(
      (g) =>
        `<div class="goal"><div><div class="ach-t">${esc(g.title)}</div><div class="muted">${esc(g.detail)}</div></div><div class="gold">${esc(g.target)}</div></div>`
    )
    .join("");
  const strategies = ai.strategies
    .map(
      (s) =>
        `<div class="goal"><div><div class="ach-t">${esc(s.title)}</div><div class="muted">${esc(s.detail)}</div></div><div class="stars">${stars(s.priority)}</div></div>`
    )
    .join("");
  const habits = `<ul class="habit-list">${(ai.habits || [])
    .map((h) => `<li><b>${esc(h.title)}</b> — ${esc(h.detail)}</li>`)
    .join("")}</ul>`;
  const timeline = ai.timeline
    .map(
      (t, i) =>
        `<div class="tl ${i === ai.timeline.length - 1 ? "ideal" : ""}"><div class="gold">${esc(t.label)}</div><div class="stars">${stars(t.stars)}</div><p class="body">${esc(t.detail)}</p></div>`
    )
    .join("");

  return `<section class="page page4">
    ${header(report, `${meta.nextMonthLabel}の目標 & プラン`, "NEXT MONTH PLAN")}
    <p class="lead">さらにレベルアップするために、${esc(meta.nextMonthLabel)}の作戦をデータから組み立てました。</p>
    <div class="grid2 page4-top">
      <section class="card fill"><h3>${esc(meta.nextMonthLabel)}の重点目標</h3>${goals}</section>
      <section class="card fill"><h3>AIが提案する作戦プラン</h3>${strategies}</section>
    </div>
    <section class="card fill habit-card"><h3>${esc(meta.nextMonthLabel)}の習慣チェックリスト</h3>${habits}</section>
    <section class="card fill"><h3>期待できる変化（AI予測）</h3><div class="timeline">${timeline}</div></section>
    ${
      trainer && (ai.closingTrainerComment || ai.trainerComment)
        ? `<section class="card trainer fill"><div class="avatar">${esc(trainer.displayName.slice(0, 1))}</div><div><h3>トレーナーからのコメント</h3><p class="body comment-body">${esc(
            ai.closingTrainerComment || ai.trainerComment
          )}</p><div class="sig">担当トレーナー ${esc(trainer.displayName)}</div></div></section>`
        : ""
    }
    <footer class="foot">あなたの努力は必ず結果につながります。${esc(meta.nextMonthLabel)}も一緒に積み上げましょう。</footer>
  </section>`;
}

const CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1A1A1A; background: #fff; }
  .page { width: 210mm; height: 297mm; padding: 7mm 8mm; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
  .brand { font-size: 10px; letter-spacing: .18em; color: ${GOLD}; font-weight: 700; width: 110px; }
  .hdr-mid { flex: 1; text-align: center; }
  .ym { color: ${GOLD}; font-size: 13px; font-weight: 600; }
  h1 { margin: 2px 0 0; font-size: 24px; letter-spacing: -.02em; }
  .sub { margin-top: 2px; font-size: 10px; letter-spacing: .16em; color: ${GOLD}; }
  .hdr-right { width: 140px; text-align: right; }
  .name { font-size: 14px; font-weight: 700; }
  .pill { display: inline-block; margin-top: 4px; border: 1px solid ${GOLD}66; background: #F5EFE3; color: ${GOLD}; border-radius: 999px; padding: 3px 9px; font-size: 11px; }
  .card { border: 1px solid #E8E4DC; border-radius: 12px; padding: 12px; margin-bottom: 8px; background: #fff; }
  h3 { margin: 0 0 8px; font-size: 15px; }
  .body { font-size: 13px; line-height: 1.55; margin: 0; }
  .body.strong { font-weight: 600; }
  .muted { color: #6B7280; font-size: 12px; }
  .gold { color: ${GOLD}; }
  .row { display: flex; gap: 12px; align-items: center; }
  .grade { width: 78px; height: 78px; border-radius: 999px; border: 2px solid ${GOLD}; background: #F5EFE3; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
  .grade-n { font-size: 24px; font-weight: 800; color: ${GOLD}; }
  .grade-l { font-size: 10px; color: ${GOLD}; }
  .scorebox { text-align: right; flex-shrink: 0; }
  .score { font-size: 40px; font-weight: 800; color: ${GOLD}; line-height: 1; }
  .stars { color: ${GOLD}; letter-spacing: 1px; font-size: 14px; }
  .trainer { display: flex; gap: 12px; }
  .avatar { width: 48px; height: 48px; border-radius: 999px; background: #F5EFE3; color: ${GOLD}; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 18px; }
  .sig { text-align: right; margin-top: 6px; font-size: 12px; color: #6B7280; }
  .foot { margin-top: 6px; text-align: center; font-size: 11px; color: #6B7280; }
  .hero-score { display: grid; grid-template-columns: 140px 1fr; gap: 8px; margin-bottom: 8px; }
  .hero-left { background: #1f2421; color: #fff; border-radius: 12px; padding: 14px; }
  .big { font-size: 48px; font-weight: 800; color: ${GOLD}; line-height: 1; margin: 4px 0; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .metric { border: 1px solid #E8E4DC; border-radius: 10px; padding: 10px; }
  .metric-v { font-size: 20px; font-weight: 700; margin-top: 2px; }
  .metric-v span { font-size: 11px; color: #6B7280; font-weight: 500; margin-left: 2px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; text-align: center; font-size: 12px; }
  .c-h { color: #6B7280; padding: 3px 0; font-size: 11px; }
  .c-d { padding: 6px 0; border-radius: 999px; }
  .c-d.on { background: ${GOLD}; color: #fff; font-weight: 700; }
  .pie-row { display: flex; gap: 10px; align-items: center; }
  .leg { font-size: 12px; display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .leg b { color: ${GOLD}; margin-left: auto; }
  .dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .ach-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .ach, .goal { border: 1px solid #E8E4DC; border-radius: 10px; padding: 10px; }
  .goal { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 6px; }
  .ach-t { font-size: 13px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #E8E4DC; }
  th { color: #6B7280; font-weight: 600; }
  td.hi { background: #F5EFE3; color: ${GOLD}; font-weight: 700; }
  .up { color: #047857; font-weight: 600; }
  .down { color: #e11d48; font-weight: 600; }
  .facts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; }
  .facts > div { border: 1px solid #E8E4DC; border-radius: 8px; padding: 8px; font-size: 12px; }
  .top { margin-bottom: 8px; }
  .top-h { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px; }
  .bar { height: 8px; background: #F5EFE3; border-radius: 999px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: ${GOLD}; }
  .trends { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .checks { margin: 0; padding: 0; list-style: none; font-size: 13px; }
  .checks li { margin-bottom: 4px; }
  .lead { text-align: center; font-size: 13px; color: #6B7280; margin: -2px 0 8px; }
  .habits { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .habit { border: 1px solid #E8E4DC; border-radius: 10px; padding: 8px; text-align: center; }
  .box { width: 14px; height: 14px; border: 1px solid #E8E4DC; border-radius: 4px; margin: 0 auto 6px; }
  .timeline { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .tl { border: 1px solid #E8E4DC; border-radius: 10px; padding: 8px; }
  .tl.ideal { background: #F5EFE3; border-color: ${GOLD}; }
  .grow { flex: 1; }
  .page1-main { display: block; }
  .page1-left, .page1-right { display: block; }
  .ba-card { background: #fff; }
  .ba-legend { margin: -2px 0 10px; font-size: 11px; color: #6B7280; text-align: center; }
  .ba-rows { display: flex; flex-direction: column; gap: 8px; }
  .ba-row { background: #2f3338; border-radius: 12px; padding: 8px 10px; }
  .ba-angle { text-align: center; color: ${GOLD}; font-size: 13px; font-weight: 700; margin-bottom: 6px; letter-spacing: .06em; }
  .ba-pair { display: grid; grid-template-columns: 1fr 22px 1fr; gap: 4px; align-items: center; }
  .ba-triple { display: grid; grid-template-columns: 1fr 16px 1fr 16px 1fr; gap: 2px; align-items: center; }
  .ba-arrow { text-align: center; color: ${GOLD}; font-size: 16px; font-weight: 700; }
  .ba-shot img, .ba-shot .photo-empty { width: 100%; aspect-ratio: 3 / 4; object-fit: contain; object-position: center center; border-radius: 8px; display: block; background: #111; }
  .ba-cap { text-align: center; font-size: 10px; color: #ccc; margin-top: 3px; font-weight: 600; line-height: 1.25; }
  .ba-cap-sub { display: block; font-size: 9px; color: #999; font-weight: 500; }
  .photo-group { background: #2f3338; border-radius: 10px; padding: 8px; color: #fff; }
  .photo-title { text-align: center; font-size: 12px; color: ${GOLD}; margin-bottom: 6px; }
  .photo-row { display: flex; justify-content: center; gap: 10px; }
  .photo-cell { flex: 0 0 30%; max-width: 160px; }
  .photo-cell img { width: 100%; aspect-ratio: 3 / 4; height: auto; object-fit: contain; object-position: center center; border-radius: 6px; display: block; background: #111; }
  .photo-empty { aspect-ratio: 3 / 4; display: flex; align-items: center; justify-content: center; background: #111; border-radius: 6px; font-size: 11px; color: #888; }
  .photo-cap { text-align: center; font-size: 11px; color: #ccc; margin-top: 3px; }
  .ba-unavailable .ba-empty-panel { background: #2f3338; border-radius: 12px; padding: 16px; color: #fff; }
  .ba-empty-slots { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .ba-empty-slot .photo-empty.tall { min-height: 160px; width: 100%; }
  .unavailable-msg, .unavailable-box {
    text-align: center; color: ${GOLD}; font-weight: 700; font-size: 14px;
    padding: 14px 10px; border: 1px dashed ${GOLD}66; border-radius: 10px; background: #F5EFE3;
  }
  .unavailable-box { color: #6B7280; border-color: #E8E4DC; background: #FAFAF8; font-weight: 600; }
  .posture-unavailable .unavailable-box { margin-top: 4px; }
  .posture-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
  .posture-item { border: 1px solid #E8E4DC; border-radius: 8px; padding: 9px; }
  .posture-sum { font-size: 13px; font-weight: 700; margin-top: 4px; }
  .posture-detail { margin-top: 4px; font-size: 12px; line-height: 1.45; }
  .muscle { border: 1px solid #E8E4DC; border-radius: 8px; padding: 9px; margin-bottom: 6px; }
`;

/** A4縦（210×297mm）相当の固定ピクセル。LINE画像4枚を同一サイズに揃える */
export const A4_PORTRAIT = { width: 1240, height: 1754 };
/** @deprecated 互換用 */
export const A4_LANDSCAPE = A4_PORTRAIT;

export function renderMonthlyProgressHtml(report) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"/><title>${esc(report.member.name)} Monthly Progress Report</title>
  <style>${CSS}
    @page { size: A4 portrait; margin: 0; }
    .page { width: 210mm; height: 297mm; padding: 8mm 9mm; }
    .ba-shot img, .ba-shot .photo-empty { max-height: 55mm; }
    .posture-detail { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  </style></head><body>
  ${page1(report)}${page2(report)}${page3(report)}${page4(report)}
  </body></html>`;
}

/** LINE送信用: A4縦サイズで全ページ統一 */
export function renderMonthlyProgressPageHtml(report, pageIndex) {
  const pages = [page1, page2, page3, page4];
  const render = pages[pageIndex];
  if (!render) throw new Error(`invalid pageIndex: ${pageIndex}`);
  const { width: W, height: H } = A4_PORTRAIT;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"/>
  <style>
    html, body { margin: 0; padding: 0; background: #fff; width: ${W}px; height: ${H}px; overflow: hidden; }
    ${CSS}
    .page {
      width: ${W}px !important;
      height: ${H}px !important;
      min-height: ${H}px !important;
      max-height: ${H}px !important;
      padding: 24px 28px 20px !important;
      overflow: hidden !important;
      display: flex;
      flex-direction: column;
      gap: 10px;
      page-break-after: auto !important;
      box-sizing: border-box;
    }
    .hdr { margin-bottom: 2px !important; flex-shrink: 0; }
    .brand { font-size: 12px !important; width: 140px !important; }
    h1 { font-size: 28px !important; }
    .ym { font-size: 14px !important; }
    .sub { font-size: 12px !important; }
    .name { font-size: 16px !important; }
    .pill { font-size: 13px !important; }
    h3 { font-size: 17px !important; margin-bottom: 8px !important; }
    .body { font-size: 15px !important; line-height: 1.5 !important; }
    .muted { font-size: 13px !important; }
    .ach-t { font-size: 15px !important; }
    .card { margin-bottom: 0 !important; padding: 12px 14px !important; flex-shrink: 0; }

    /* Page1: 体型写真 + 姿勢分析 + 筋肉 */
    .page1 .ba-card { flex: 1.05; display: flex; flex-direction: column; min-height: 0; }
    .page1 .ba-legend { font-size: 13px !important; margin: 0 0 6px !important; }
    .page1 .ba-rows { flex: 1; gap: 6px !important; min-height: 0; display: flex; flex-direction: column; }
    .page1 .ba-row { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 6px 8px !important; }
    .page1 .ba-angle { font-size: 13px !important; margin-bottom: 3px !important; flex-shrink: 0; }
    .page1 .ba-pair { flex: 1; min-height: 0; grid-template-columns: 1fr 20px 1fr !important; align-items: center !important; }
    .page1 .ba-triple { flex: 1; min-height: 0; grid-template-columns: 1fr 12px 1fr 12px 1fr !important; align-items: center !important; }
    .page1 .ba-arrow { font-size: 14px !important; }
    .page1 .ba-cap { font-size: 10px !important; }
    .page1 .ba-cap-sub { font-size: 8px !important; }
    .page1 .ba-shot { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; height: 100%; }
    .page1 .ba-shot img, .page1 .ba-shot .photo-empty {
      width: auto !important; max-width: 100% !important; height: auto !important; max-height: 100% !important;
      aspect-ratio: 3 / 4 !important; object-fit: contain !important;
    }
    .page1 .posture-card { flex-shrink: 0; }
    .page1 .posture-grid { grid-template-columns: repeat(3, 1fr) !important; gap: 6px !important; }
    .page1 .posture-item { padding: 7px !important; }
    .page1 .posture-sum { font-size: 12px !important; }
    .page1 .posture-detail { font-size: 11px !important; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .page1 .muscle-grid { flex-shrink: 0; gap: 8px !important; }
    .page1 .muscle { padding: 7px !important; margin-bottom: 4px !important; }
    .page1 .muscle .ach-t { font-size: 13px !important; }
    .page1 .muscle .muted { font-size: 11px !important; }
    .page1 .ba-unavailable { flex: 1.05; display: flex; flex-direction: column; min-height: 0; }
    .page1 .ba-empty-panel { flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 280px; }
    .page1 .ba-empty-slot .photo-empty.tall { min-height: 200px !important; }
    .page1 .unavailable-msg { font-size: 18px !important; padding: 18px !important; margin-top: 8px; }
    .page1 .unavailable-box { font-size: 14px !important; padding: 16px 10px !important; }
    .page1 .foot { margin-top: 2px; flex-shrink: 0; font-size: 12px !important; }

    /* Page2: スコア上・大きく、来店/比率/できたこと、FB */
    .page2 { gap: 8px !important; }
    .page2 .score-hero {
      display: grid !important;
      grid-template-columns: 160px 1fr !important;
      grid-template-rows: auto auto;
      gap: 10px 14px !important;
      padding: 16px 18px !important;
      background: #fff;
      border: 1px solid #E8E4DC;
      border-radius: 12px;
      flex-shrink: 0;
    }
    .page2 .score-hero-left {
      grid-row: 1 / 3;
      background: #1f2421;
      color: #fff;
      border-radius: 12px;
      padding: 16px 14px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .page2 .score-hero-n { font-size: 72px !important; font-weight: 800; color: ${GOLD}; line-height: 1; margin: 4px 0; }
    .page2 .grade-inline { margin-top: 8px; color: ${GOLD}; font-weight: 700; font-size: 16px; }
    .page2 .score-hero-right { grid-column: 2; }
    .page2 .score-hero-right .comment-body { font-size: 16px !important; line-height: 1.5 !important; margin-top: 6px !important; }
    .page2 .score-metrics {
      grid-column: 2;
      display: grid !important;
      grid-template-columns: repeat(4, 1fr) !important;
      gap: 6px !important;
    }
    .page2 .score-metrics .metric { padding: 10px !important; }
    .page2 .score-metrics .metric-v { font-size: 20px !important; }
    .page2 .page2-mid { flex: 1.1; min-height: 0; gap: 10px !important; align-items: stretch; }
    .page2 .mid-card { height: 100%; display: flex; flex-direction: column; padding: 14px !important; }
    .page2 .cal { font-size: 15px !important; flex: 1; }
    .page2 .c-d { padding: 9px 0 !important; }
    .page2 .pie-row { flex: 1; align-items: center; }
    .page2 .leg { font-size: 15px !important; margin-bottom: 6px !important; }
    .page2 .ach-section { flex-shrink: 0; padding: 14px !important; }
    .page2 .ach-grid { grid-template-columns: 1fr 1fr !important; gap: 8px !important; }
    .page2 .ach { padding: 12px !important; }
    .page2 .ach-t { font-size: 15px !important; }
    .page2 .ach .muted { font-size: 13px !important; }
    .page2 .fb-section { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px !important; }
    .page2 .fb-list { display: flex; flex-direction: column; gap: 10px; flex: 1; overflow: hidden; }
    .page2 .fb-item { border: 1px solid #E8E4DC; border-radius: 10px; padding: 10px 12px; }
    .page2 .fb-head { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
    .page2 .avatar.sm { width: 36px; height: 36px; font-size: 14px; border-radius: 999px; background: #F5EFE3; color: ${GOLD}; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
    .page2 .fb-item .body { font-size: 14px !important; line-height: 1.45 !important; }

    /* Page3: 推移とハイライト横並び、総評・トレーナー大きめ */
    .page3 { gap: 10px !important; }
    .page3 table { font-size: 14px !important; }
    .page3 th, .page3 td { padding: 7px 5px !important; }
    .page3 .facts { grid-template-columns: repeat(5, 1fr) !important; }
    .page3 .facts > div { font-size: 13px !important; padding: 10px !important; }
    .page3 .grid2 { gap: 10px !important; flex-shrink: 0; }
    .page3 .trend-highlight { flex: 1; min-height: 0; align-items: stretch; }
    .page3 .trend-highlight .card { height: 100%; display: flex; flex-direction: column; }
    .page3 .trends { grid-template-columns: 1fr !important; gap: 10px !important; flex: 1; }
    .page3 .trends .muted { font-size: 14px !important; }
    .page3 .trends .gold { font-size: 18px !important; font-weight: 700; }
    .page3 .checks { font-size: 15px !important; }
    .page3 .checks li { margin-bottom: 10px !important; }
    .page3 .checks .muted { font-size: 13px !important; margin-top: 2px; }
    .page3 .comment-row { flex-shrink: 0; align-items: stretch; }
    .page3 .comment-card { min-height: 140px; }
    .page3 .comment-body { font-size: 16px !important; line-height: 1.55 !important; margin-top: 8px !important; }
    .page3 .top-h { font-size: 14px !important; }
    .page3 .leg { font-size: 14px !important; }

    /* Page4: 余白を埋めて文字大きく */
    .page4 { gap: 14px !important; justify-content: stretch; }
    .page4 .lead { font-size: 17px !important; margin: 0 !important; color: #4B5563 !important; flex-shrink: 0; }
    .page4 .page4-top { flex: 1.2; min-height: 220px; align-items: stretch; gap: 14px !important; }
    .page4 .fill { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .page4 .card.fill { padding: 18px 20px !important; }
    .page4 h3 { font-size: 20px !important; margin-bottom: 14px !important; }
    .page4 .goal { padding: 16px !important; margin-bottom: 12px !important; flex: 1; }
    .page4 .ach-t { font-size: 17px !important; }
    .page4 .muted { font-size: 15px !important; }
    .page4 .gold { font-size: 16px !important; font-weight: 700; }
    .page4 .habits { display: none !important; }
    .page4 .habit-card { flex: 0.55; min-height: 0; }
    .page4 .habit-list { margin: 0; padding-left: 1.2em; font-size: 15px; line-height: 1.7; }
    .page4 .habit-list li { margin-bottom: 4px; }
    .page4 .habit-list b { color: #1A1A1A; }
    .page4 .timeline { grid-template-columns: repeat(2, 1fr) !important; gap: 12px !important; flex: 1; }
    .page4 .tl { padding: 16px !important; display: flex; flex-direction: column; justify-content: center; height: 100%; }
    .page4 .tl .body { font-size: 16px !important; }
    .page4 .tl .gold { font-size: 17px !important; }
    .page4 .trainer { flex: 0.7; padding: 18px 20px !important; min-height: 120px; }
    .page4 .comment-body { font-size: 17px !important; line-height: 1.55 !important; }
    .page4 .stars { font-size: 18px !important; }
    .page4 .foot { margin-top: 2px; flex-shrink: 0; font-size: 14px !important; }
    .page4 .sig { font-size: 15px !important; }
    .page3 .comment-body { font-size: 17px !important; line-height: 1.55 !important; margin-top: 8px !important; }
    .page3 .comment-card { min-height: 160px; }
    .page3 .checks { font-size: 16px !important; }
    .page3 .trends .gold { font-size: 20px !important; font-weight: 700; }
  </style></head><body>${render(report)}</body></html>`;
}

export const MONTHLY_PROGRESS_PAGE_TITLES = [
  "1/4 成長レポート",
  "2/4 成果サマリー",
  "3/4 トレーニング分析",
  "4/4 来月の目標＆プラン",
];


export function renderLineCardHtml(report) {
  const best = report.weightRows[0];
  const lifts = report.weightRows
    .slice(0, 4)
    .map((r) => {
      const maxDelta = Math.max(1, ...report.weightRows.slice(0, 4).map((x) => Math.max(0, x.vsFirst)));
      const w = Math.max(8, Math.round((Math.max(0, r.vsFirst) / maxDelta) * 100));
      return `<div class="lift"><div class="lh"><span>${esc(r.exercise)}</span><span class="d">+${esc(r.vsFirst)}kg</span></div>
        <div class="tr"><div class="fl" style="width:${w}%"></div></div>
        <div class="meta">${esc(r.firstMax)}kg → ${esc(r.monthMax)}kg</div></div>`;
    })
    .join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{width:1080px;height:1920px;background:#1a2420;color:#f7f3ee;font-family:"Hiragino Mincho ProN","Yu Mincho",serif}
    .w{padding:72px 64px;height:100%;display:flex;flex-direction:column}
    .brand{font-family:"Avenir Next",sans-serif;letter-spacing:.3em;color:${GOLD};font-size:22px;font-weight:700}
    h1{font-size:58px;line-height:1.2;margin:24px 0 10px}
    .sub{font-family:"Avenir Next",sans-serif;color:#b7c0b8;font-size:22px;margin-bottom:40px}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:40px}
    .st{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);padding:24px;border-radius:10px}
    .n{font-family:"Avenir Next",sans-serif;font-size:52px;font-weight:700;color:${GOLD}}
    .l{margin-top:6px;color:#9aa89c;font-size:18px;font-family:"Avenir Next",sans-serif}
    h2{font-size:26px;color:${GOLD};margin-bottom:18px}
    .lh{display:flex;justify-content:space-between;font-size:26px}
    .d{color:${GOLD};font-family:"Avenir Next",sans-serif;font-weight:700}
    .tr{height:12px;background:rgba(255,255,255,.08);margin-top:10px;border-radius:4px;overflow:hidden}
    .fl{height:100%;background:linear-gradient(90deg,#2f6b4f,${GOLD})}
    .meta{margin-top:8px;color:#9aa89c;font-size:18px;font-family:"Avenir Next",sans-serif}
    .lift{margin-bottom:22px}
    .box{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:28px;margin-top:12px}
    .box li{font-size:24px;line-height:1.5;margin:0 0 10px 1.1em}
    .sp{flex:1}
    .ft{font-family:"Avenir Next",sans-serif;color:#7f8c82;font-size:16px;letter-spacing:.08em}
  </style></head><body><div class="w">
    <div class="brand">ABODY · MONTHLY PROGRESS</div>
    <h1>${esc(report.member.name)}様<br/>${esc(report.meta.yearMonthLabel)}の成長レポート</h1>
    <div class="sub">${esc(report.member.storeName)} · ${esc(report.member.memberCode)} · 確認用</div>
    <div class="stats">
      <div class="st"><div class="n">${esc(report.metrics.visitCount)}</div><div class="l">SESSIONS</div></div>
      <div class="st"><div class="n">${esc(report.metrics.abodyScore)}</div><div class="l">ABODY SCORE</div></div>
      <div class="st"><div class="n">${esc(best ? `+${best.vsFirst}` : "—")}</div><div class="l">${esc(best?.exercise || "GROWTH")} kg</div></div>
    </div>
    <h2>種目の伸び（初回最高 → 今月最高）</h2>
    ${lifts}
    <div class="box"><h2>${esc(report.meta.nextMonthLabel)}の進め方</h2><ol>${report.ai.goals
      .slice(0, 3)
      .map((g) => `<li>${esc(g.title)} — ${esc(g.detail)}</li>`)
      .join("")}</ol></div>
    <div class="sp"></div>
    <div class="ft">PILOT · NOT SENT TO MEMBER · REVIEW VIA EBI020</div>
  </div></body></html>`;
}
