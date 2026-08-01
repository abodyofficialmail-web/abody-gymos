import type { MonthlyProgressReport, WeightProgressRow, PartRatio } from "./types";

type AiInput = {
  name: string;
  monthLabel: string;
  nextMonthLabel: string;
  visitCount: number;
  totalMinutes: number;
  partRatios: PartRatio[];
  weightRows: WeightProgressRow[];
  feedbacks: string[];
  avgSatisfaction: number | null;
  hasPhotos: boolean;
  trainerName: string | null;
  tenureMonths: number;
};

function topPart(ratios: PartRatio[]): string {
  return ratios[0]?.part || "全身";
}

export function generateAiCopy(input: AiInput): MonthlyProgressReport["ai"] {
  const improved = [...input.weightRows].filter((r) => r.vsFirst > 0).sort((a, b) => b.vsFirst - a.vsFirst);
  const plateau = [...input.weightRows]
    .filter((r) => r.vsPrev != null && r.vsPrev <= 0 && r.julySets >= 3)
    .sort((a, b) => (a.vsPrev || 0) - (b.vsPrev || 0));
  const best = improved[0];
  const stuck = plateau[0] || input.weightRows.find((r) => r.vsFirst <= 0);
  const focus = topPart(input.partRatios);
  const fbText = input.feedbacks.join(" ");

  const postureHints = {
    balance: /姿勢|バランス|ぶれ/.test(fbText),
    kyphosis: /猫背|胸椎|肩/.test(fbText),
    pelvis: /骨盤/.test(fbText),
    ankle: /足首|重心/.test(fbText),
    back: /背中|下部/.test(fbText),
    squat: /スクワット|安定/.test(fbText),
  };

  const postureItems = input.hasPhotos
    ? [
        {
          key: "balance",
          label: "姿勢バランス",
          stars: postureHints.balance || postureHints.squat ? 4 : 3,
          summary: postureHints.balance ? "安定感が向上" : "基礎は良好",
          detail: postureHints.balance
            ? "トレーナーFBでも姿勢・安定の改善が繰り返し触れられており、立ち姿勢の左右差が小さくなってきています。"
            : "大きな崩れは見られず、継続でさらに整えていける段階です。",
        },
        {
          key: "kyphosis",
          label: "猫背・胸椎",
          stars: postureHints.kyphosis ? 4 : 3,
          summary: postureHints.kyphosis ? "伸展意識が出てきた" : "維持できている",
          detail: "トレーニング中の胸を開く意識がフォーム安定につながっています。",
        },
        {
          key: "shoulder",
          label: "肩の左右差",
          stars: 3,
          summary: "大きな偏りなし",
          detail: "高重量時に入りやすい側差を、アップと肩甲骨操作で抑えていく段階です。",
        },
        {
          key: "pelvis",
          label: "骨盤の安定",
          stars: postureHints.pelvis ? 5 : 3,
          summary: postureHints.pelvis ? "使い方が上手" : "安定を強化中",
          detail: postureHints.pelvis
            ? "骨盤の使い方が良くなっている、との評価が複数回あり、下半身種目の質が上がっています。"
            : "ヒンジとスクワットで骨盤ニュートラルを意識するとさらに伸びます。",
        },
        {
          key: "hipline",
          label: "ヒップライン",
          stars: focus.includes("脚") ? 4 : 3,
          summary: focus.includes("脚") ? "下半身刺激が充実" : "これから伸ばせる",
          detail: "脚トレ比率が高く、臀部・脚の引き締めにつながる刺激が十分入っています。",
        },
        {
          key: "back",
          label: "背中の厚み",
          stars: postureHints.back ? 4 : 3,
          summary: postureHints.back ? "下部の動きが改善" : "厚みづくり余地あり",
          detail: postureHints.back
            ? "背中下部の動き改善が確認できており、ローイング系の質が上がっています。"
            : "ローイングとプル系で厚みを積み上げる余地があります。",
        },
      ]
    : [];

  const overallAnalysisFallback = best
    ? `${input.monthLabel}は来店${input.visitCount}回・合計${input.totalMinutes}分。特に${best.exercise}が初回${best.firstMax}kg→${best.monthMax}kg（+${best.vsFirst}kg）と伸び、${focus}中心の配分が成長を後押ししました。${
        postureHints.pelvis || postureHints.ankle || postureHints.squat
          ? "フォーム面では足首・骨盤・体幹の安定が評価されており、筋力だけでなく動きの質も上がっています。"
          : "回数を重ねるほど動作が安定し、トレーニングの再現性が高まっています。"
      }`
    : `${input.monthLabel}は来店${input.visitCount}回。継続自体が大きな成果です。フォームを整えながら負荷を積むフェーズに入れています。`;

  const overallComment = best
    ? `${input.monthLabel}はフォームが安定し、${best.exercise}をはじめ筋力向上もはっきり見られました。忙しい中でも${input.visitCount}回来店できたことが、数字と動きの両方に表れています。`
    : `${input.monthLabel}は継続 Habit が確立し、セッションの質が上がってきています。`;

  const achievements = [
    {
      title: `週${Math.round(input.visitCount / 4)}回ペース達成`,
      detail: `${input.monthLabel}は${input.visitCount}回来店。習慣として定着しています。`,
    },
    best
      ? {
          title: `${best.exercise} +${best.vsFirst}kg`,
          detail: `初回${best.firstMax}kgから${best.monthMax}kgへ。一番伸びた種目です。`,
        }
      : { title: "メニュー消化が安定", detail: "種目の再現性が上がり、セットを丁寧にこなせています。" },
    postureHints.squat || postureHints.ankle
      ? { title: "スクワットの安定", detail: "体幹のブレ低減・足首の重心が良くなっていると評価されています。" }
      : { title: "フォーム意識の定着", detail: "修正ポイントへの反応が早く、質の高い反復ができています。" },
    postureHints.pelvis
      ? { title: "骨盤の使い方向上", detail: "引き締めと連動して、骨盤操作の上手さがコメントされています。" }
      : null,
    input.avgSatisfaction != null && input.avgSatisfaction >= 4.5
      ? { title: "高い満足度を維持", detail: `平均満足度 ${input.avgSatisfaction}/5。楽しく続けられる状態です。` }
      : { title: "ストレッチ・ケアの意識", detail: "メイン種目だけでなく、動きづくりの時間も取れています。" },
  ].filter(Boolean) as { title: string; detail: string }[];

  const analysis = {
    mostImproved: best
      ? `${best.exercise}（+${best.vsFirst}kg / 初回比 +${best.growthPct}%）`
      : "継続による動作安定",
    plateau: stuck
      ? `${stuck.exercise}（${stuck.vsPrev != null ? `先月比 ${stuck.vsPrev >= 0 ? "+" : ""}${stuck.vsPrev}kg` : "伸び悩み"}）`
      : "目立った停滞なし",
    focusPart: focus,
    strongPart: focus.includes("脚") ? "下半身（スクワット系）" : focus,
    challengePart: stuck?.exercise || "上半身の厚みづくり",
    narrative: `${input.name}さんは${input.monthLabel}、${focus}を軸にバランスよく消化できています。${
      best
        ? `成長の主因は「来店頻度の確保」と「${best.exercise}など基礎種目の反復」です。`
        : "成長の主因は来店頻度とフォーム修正への素直さです。"
    }${
      stuck
        ? `一方で${stuck.exercise}は負荷の再設計（レップレンジやセット構成）で再加速できます。`
        : "全体的に右肩上がりで、来月も同じリズムで伸ばせます。"
    }`,
  };

  const nextTarget = best ? Math.round((best.monthMax + 2.5) * 2) / 2 : 0;
  const goals = [
    best
      ? {
          title: `${best.exercise} ${nextTarget}kg`,
          detail: `フォームを崩さない範囲で +2.5kg を狙う`,
          target: `${nextTarget}kg`,
        }
      : { title: "基礎種目の重量更新", detail: "主要種目で自己ベスト更新", target: "更新" },
    {
      title: `週3回来店`,
      detail: `${input.nextMonthLabel}も習慣を維持`,
      target: "週3回",
    },
    {
      title: "水分 2L以上",
      detail: "夏場のコンディション維持",
      target: "2L+",
    },
    {
      title: "睡眠 7時間+",
      detail: "回復を優先して筋力を伸ばす",
      target: "7h+",
    },
    {
      title: "ストレッチ習慣",
      detail: "セッション外でも短時間でOK",
      target: "週4回",
    },
  ];

  const strategies = [
    {
      title: `${focus}の強化継続`,
      detail: `${input.monthLabel}の主戦場。得意をさらに伸ばす。`,
      priority: 5,
    },
    {
      title: stuck ? `${stuck.exercise}の再設計` : "背中の厚みづくり",
      detail: stuck
        ? "レップ・テンポを変えて刺激を入れ直す"
        : "ローイング系を週1で厚く入れる",
      priority: 4,
    },
    {
      title: "モビリティ（足首・骨盤）",
      detail: "アップを長めに取り、深い可動でも安定させる",
      priority: 4,
    },
    {
      title: "たんぱく質・食事の最適化",
      detail: "トレ日は体重×1.6g目安を意識",
      priority: 3,
    },
    {
      title: "週3来店の死守",
      detail: "忙しい週でも最低2回は確保",
      priority: 5,
    },
  ];

  const habits = [
    { key: "visit", title: "来店", detail: "週3回を目指す" },
    { key: "water", title: "水分", detail: "1日2L以上" },
    { key: "sleep", title: "睡眠", detail: "7時間以上" },
    { key: "meal", title: "食事", detail: "たんぱく質を意識" },
    { key: "stretch", title: "ストレッチ", detail: "就寝前5分" },
  ];

  const timeline = [
    {
      label: `${input.nextMonthLabel}末（1ヶ月後）`,
      detail: best
        ? `${best.exercise} ${nextTarget}kg とフォーム安定が目標`
        : "週3来店の定着と主要種目の更新",
      stars: 4,
    },
    {
      label: "2ヶ月後",
      detail: `${focus}の筋量・引き締めが目に見えてくる時期`,
      stars: 4,
    },
    {
      label: "3ヶ月後",
      detail: "全身のバランスと姿勢の完成度が一段上がる",
      stars: 5,
    },
    {
      label: "理想の姿",
      detail: "無理なく続き、数字も見た目も自信につながる状態",
      stars: 5,
    },
  ];

  const trainerComment = input.trainerName
    ? `${input.name}さん、${input.monthLabel}もお疲れ様でした。${
        best
          ? `${best.exercise}の伸び（${best.firstMax}→${best.monthMax}kg）は本当に素晴らしいです。`
          : "継続できていること自体が一番の成果です。"
      }${
        postureHints.pelvis || postureHints.squat
          ? "骨盤や体幹の安定も良くなってきているので、来月は質を落とさず負荷を少しずつ上げていきましょう。"
          : "来月も無理のない範囲で、できていることを積み上げていきましょう。"
      }`
    : null;

  const closingTrainerComment = trainerComment
    ? `${input.nextMonthLabel}は「習慣の維持」と「${best?.exercise || "基礎種目"}の更新」を一緒に狙いましょう。忙しいときほど、短時間でも来店する価値があります。またジムでお待ちしています！`
    : null;

  return {
    overallComment,
    postureItems,
    overallAnalysisFallback,
    achievements: achievements.slice(0, 5),
    analysis,
    goals,
    strategies,
    habits,
    timeline,
    trainerComment,
    closingTrainerComment,
  };
}
