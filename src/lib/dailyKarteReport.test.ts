import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import {
  formatDailyKarteReport,
  isKarteSent,
  sessionIsReportable,
  type DailyKarteSession,
} from "./dailyKarteReport.ts";

const TZ = "Asia/Tokyo";

function session(partial: Partial<DailyKarteSession> & Pick<DailyKarteSession, "storeId" | "startAt" | "sent">): DailyKarteSession {
  return {
    trainerId: "t1",
    trainerName: "ゆうと",
    memberId: "m1",
    memberCode: "EBI001",
    memberName: "山田太郎",
    ...partial,
  };
}

describe("isKarteSent", () => {
  it("counts a note from the same trainer", () => {
    assert.equal(
      isKarteSent({ memberId: "m1", trainerId: "t1" }, [{ memberId: "m1", trainerId: "t1" }]),
      true
    );
  });

  it("does not count another trainer's note", () => {
    assert.equal(
      isKarteSent({ memberId: "m1", trainerId: "t1" }, [{ memberId: "m1", trainerId: "t2" }]),
      false
    );
  });

  it("counts a note when the trainer is missing on either side", () => {
    assert.equal(isKarteSent({ memberId: "m1", trainerId: "t1" }, [{ memberId: "m1", trainerId: null }]), true);
    assert.equal(isKarteSent({ memberId: "m1", trainerId: null }, [{ memberId: "m1", trainerId: "t2" }]), true);
  });
});

describe("sessionIsReportable", () => {
  const now = DateTime.fromISO("2026-10-30T13:30:00.000Z", { zone: TZ });

  it("includes a session that has already ended today", () => {
    assert.equal(
      sessionIsReportable(
        { startAt: "2026-10-30T11:00:00.000Z", endAt: "2026-10-30T12:00:00.000Z" },
        now,
        "2026-10-30"
      ),
      true
    );
  });

  it("skips a session that is still running at report time", () => {
    assert.equal(
      sessionIsReportable(
        { startAt: "2026-10-30T13:00:00.000Z", endAt: "2026-10-30T14:00:00.000Z" },
        now,
        "2026-10-30"
      ),
      false
    );
  });

  it("includes the whole past day", () => {
    assert.equal(
      sessionIsReportable(
        { startAt: "2026-10-29T13:00:00.000Z", endAt: "2026-10-29T14:00:00.000Z" },
        now,
        "2026-10-29"
      ),
      true
    );
  });
});

describe("formatDailyKarteReport", () => {
  const stores = [
    { id: "ueno", name: "上野" },
    { id: "ebisu", name: "恵比寿" },
  ];

  it("lists each store, trainer rate, and who is unsent", () => {
    const text = formatDailyKarteReport({
      dateYmd: "2026-10-30",
      stores,
      sessions: [
        session({
          storeId: "ebisu",
          startAt: "2026-10-30T12:00:00.000Z",
          sent: false,
        }),
        session({
          storeId: "ebisu",
          trainerId: "t1",
          startAt: "2026-10-30T09:00:00.000Z",
          memberId: "m2",
          memberCode: "EBI002",
          memberName: "佐藤花",
          sent: true,
        }),
        session({
          storeId: "ueno",
          trainerId: "t2",
          trainerName: "ひろむ",
          startAt: "2026-10-30T01:00:00.000Z",
          memberId: "m3",
          memberCode: "UEN010",
          memberName: "高橋",
          sent: true,
        }),
      ],
    });

    assert.match(text, /^【日報】2026年10月30日（金）/);
    const ebisu = text.indexOf("━━ 恵比寿 ━━");
    const ueno = text.indexOf("━━ 上野 ━━");
    assert.ok(ebisu >= 0 && ebisu < ueno);
    assert.match(text, /ゆうと　2セッション　カルテ送信 50%（1\/2）/);
    assert.match(text, /未送信 1件\n・21:00 山田太郎（EBI001）/);
    assert.match(text, /ひろむ　1セッション　カルテ送信 100%（1\/1）/);
    assert.match(text, /合計　3セッション　カルテ送信 67%（2\/3）\n未送信 1件$/);
    const uenoBlock = text.slice(ueno, text.indexOf("合計"));
    assert.doesNotMatch(uenoBlock, /未送信/);
  });

  it("shows an empty store and omits unsent when everyone sent", () => {
    const text = formatDailyKarteReport({
      dateYmd: "2026-10-30",
      stores,
      sessions: [
        session({
          storeId: "ebisu",
          startAt: "2026-10-30T03:00:00.000Z",
          sent: true,
        }),
      ],
    });
    assert.match(text, /━━ 上野 ━━\nセッションなし/);
    assert.match(text, /カルテ送信 100%（1\/1）/);
    assert.doesNotMatch(text, /未送信/);
    assert.match(text, /合計　1セッション　カルテ送信 100%（1\/1）$/);
  });
});
