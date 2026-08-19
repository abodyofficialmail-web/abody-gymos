import { GOAL_HEARING_ACCENT } from "@/lib/goalHearing";

export const GOAL_HEARING_INVITE_ALT_TEXT = "【目標ヒアリングのお願い】ご協力をお願いいたします";

export const GOAL_HEARING_INVITE_BODY = `【目標ヒアリングのお願い🏋️】

いつもAbodyをご利用いただきありがとうございます！

今後、より一人ひとりの目標に合わせたトレーニングやサポートを行っていくため、目標ヒアリングへのご協力をお願いいたします。

今回のヒアリングでは、

・今後の目標、なりたい身体
・理想の体型がわかる写真（1枚以上）
・生活習慣
・トレーニングで改善したいこと

などをお伺いします！

以前ヒアリングにご回答いただいた会員様も、システム移行に伴い最新の情報を改めて登録させていただくため、お手数をおかけしますが再度ご回答をお願いいたします🙇‍♂️

ご回答いただいた内容と、これまでのセッション記録をもとに、今後のトレーニング方針や目標設定、より一人ひとりに合わせたサポートに活用していきます💪
また月末のAbodyトレーニングレポートにも活用される内容となりますので必ずご回答をお願いいたします🙇

⏱ 所要時間：5〜8分程度

より良いサポートのため、皆さまのご協力をお願いいたします！

▼ヒアリングはこちら`;

/** 本文テキスト + 回答ボタン（長文でも見やすい） */
export function buildGoalHearingInviteMessages(surveyUrl: string) {
  return [
    {
      type: "text" as const,
      text: GOAL_HEARING_INVITE_BODY,
    },
    {
      type: "flex" as const,
      altText: GOAL_HEARING_INVITE_ALT_TEXT,
      contents: {
        type: "bubble" as const,
        size: "mega" as const,
        body: {
          type: "box" as const,
          layout: "vertical" as const,
          spacing: "md" as const,
          contents: [
            {
              type: "text" as const,
              text: "目標ヒアリング",
              weight: "bold" as const,
              size: "lg" as const,
              color: "#1e293b",
            },
            {
              type: "text" as const,
              text: "所要5〜8分／なりたい体型の写真（1枚以上）必須",
              wrap: true,
              size: "sm" as const,
              color: "#334155",
            },
            {
              type: "button" as const,
              style: "primary" as const,
              color: GOAL_HEARING_ACCENT,
              height: "sm" as const,
              action: {
                type: "uri" as const,
                label: "ヒアリングに回答する",
                uri: surveyUrl,
              },
            },
          ],
        },
      },
    },
  ];
}

/** @deprecated 互換用。新規は buildGoalHearingInviteMessages を使う */
export function buildGoalHearingFlex(surveyUrl: string) {
  return buildGoalHearingInviteMessages(surveyUrl)[1];
}
