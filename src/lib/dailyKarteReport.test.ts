import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import {
  buildStoreDayFacts,
  countOpenSlots,
  coveringTrainerIds,
  formatDailyKarteReport,
  isKarteSent,
  isSameDayCancellation,
  resolveSessionTrainer,
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

describe("resolveSessionTrainer", () => {
  const shifts = [
    { storeId: "ueno", trainerId: "hiromu", startMin: 10 * 60, endMin: 18 * 60 },
    { storeId: "ueno", trainerId: "seiya", startMin: 17 * 60, endMin: 22 * 60 },
  ];

  it("uses the only trainer on shift when the reservation has none", () => {
    const cover = coveringTrainerIds(shifts, "ueno", 11 * 60, 12 * 60);
    assert.deepEqual(resolveSessionTrainer({ reservationTrainerId: null, noteTrainerIds: [], coveringTrainerIds: cover }), [
      "hiromu",
    ]);
  });

  it("keeps both trainers when they overlap and nobody wrote the karte", () => {
    const cover = coveringTrainerIds(shifts, "ueno", 17 * 60, 18 * 60);
    assert.deepEqual(
      resolveSessionTrainer({ reservationTrainerId: null, noteTrainerIds: [], coveringTrainerIds: cover }).sort(),
      ["hiromu", "seiya"]
    );
  });

  it("uses the trainer who wrote the karte when several people are on shift", () => {
    const cover = coveringTrainerIds(shifts, "ueno", 17 * 60, 18 * 60);
    assert.deepEqual(
      resolveSessionTrainer({ reservationTrainerId: null, noteTrainerIds: ["seiya"], coveringTrainerIds: cover }),
      ["seiya"]
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
    assert.match(text, /ゆうと　2件　送信50%（1\/2）/);
    assert.match(text, /未送信 1件\n・21:00 山田太郎（EBI001）/);
    assert.match(text, /ひろむ　1件　送信100%（1\/1）/);
    assert.match(text, /合計　3件　送信67%（2\/3）\n未送信 1件$/);
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
    assert.match(text, /送信100%（1\/1）/);
    assert.doesNotMatch(text, /未送信/);
    assert.match(text, /合計　1件　送信100%（1\/1）$/);
  });

  it("adds shifts, reservation counts, open slots, and same-day cancels", () => {
    const text = formatDailyKarteReport({
      dateYmd: "2026-10-30",
      stores,
      sessions: [],
      factsByStoreId: {
        ebisu: { shifts: [], reservations: 0, openSlots: 0, sameDayCancels: 0 },
        ueno: {
          shifts: [
            { trainerName: "ひろむ", ranges: ["10:00–18:00"] },
            { trainerName: "せいや", ranges: ["10:00–14:00", "17:00–22:00"] },
          ],
          reservations: 14,
          openSlots: 3,
          sameDayCancels: 1,
        },
      },
    });
    assert.match(text, /━━ 恵比寿 ━━\nシフトなし\n予約 0　空き 0　当日キャンセル 0\nセッションなし/);
    assert.match(
      text,
      /━━ 上野 ━━\nシフト\nひろむ 10:00–18:00\nせいや 10:00–14:00・17:00–22:00\n予約 14　空き 3　当日キャンセル 1\nセッションなし/
    );
    assert.match(text, /予約 14　空き 3　当日キャンセル 1$/);
  });
});

describe("countOpenSlots", () => {
  it("counts 30-minute openings and lets an unassigned reservation consume capacity", () => {
    assert.equal(
      countOpenSlots({
        storeName: "上野",
        shifts: [{ id: "s1", trainerId: "t1", startMin: 10 * 60, endMin: 11 * 60 }],
        breaks: [],
        reservations: [],
        events: [],
      }),
      2
    );
    assert.equal(
      countOpenSlots({
        storeName: "上野",
        shifts: [{ id: "s1", trainerId: "t1", startMin: 10 * 60, endMin: 11 * 60 }],
        breaks: [{ shiftId: "s1", startMin: 10 * 60, endMin: 10 * 60 + 30 }],
        reservations: [{ trainerId: null, startMin: 10 * 60 + 30, endMin: 11 * 60 }],
        events: [],
      }),
      0
    );
  });

  it("keeps Shinjuku at one opening even when two trainers are free", () => {
    assert.equal(
      countOpenSlots({
        storeName: "新宿",
        shifts: [
          { id: "a", trainerId: "t1", startMin: 10 * 60, endMin: 10 * 60 + 30 },
          { id: "b", trainerId: "t2", startMin: 10 * 60, endMin: 10 * 60 + 30 },
        ],
        breaks: [],
        reservations: [],
        events: [],
      }),
      1
    );
  });
});

describe("buildStoreDayFacts", () => {
  const stores = [{ id: "ueno", name: "上野" }];
  const names = new Map([["t1", "ひろむ"]]);

  it("counts bookings, skips invite-only shifts, and dedupes same-day cancels", () => {
    const facts = buildStoreDayFacts({
      stores,
      dateYmd: "2026-10-30",
      shiftRows: [
        {
          id: "s1",
          store_id: "ueno",
          trainer_id: "t1",
          start_local: "10:00:00",
          end_local: "11:00:00",
          is_break: false,
          booking_visibility: "public",
        },
        {
          id: "s2",
          store_id: "ueno",
          trainer_id: "t1",
          start_local: "18:00:00",
          end_local: "19:00:00",
          is_break: false,
          booking_visibility: "invite",
        },
      ],
      trainerNameById: names,
      reservationRows: [
        {
          id: "r1",
          store_id: "ueno",
          trainer_id: "t1",
          start_at: "2026-10-30T01:00:00.000Z",
          end_at: "2026-10-30T01:30:00.000Z",
          status: "confirmed",
        },
        {
          id: "hold",
          store_id: "ueno",
          trainer_id: null,
          start_at: "2026-10-30T03:00:00.000Z",
          end_at: "2026-10-30T04:00:00.000Z",
          status: "confirmed",
          blocks_capacity: false,
        },
        {
          id: "c1",
          store_id: "ueno",
          trainer_id: "t1",
          start_at: "2026-10-30T05:00:00.000Z",
          end_at: "2026-10-30T06:00:00.000Z",
          status: "cancelled",
          notes: "same_day_cancel=no_show",
          updated_at: "2026-10-30T04:00:00.000Z",
        },
      ],
      breaks: [],
      events: [],
      cancelLogs: [
        {
          reservation_id: "c1",
          before_store_id: "ueno",
          before_start_at: "2026-10-30T05:00:00.000Z",
          created_at: "2026-10-30T04:00:00.000Z",
        },
        {
          reservation_id: "future",
          before_store_id: "ueno",
          before_start_at: "2026-10-31T01:00:00.000Z",
          created_at: "2026-10-30T04:00:00.000Z",
        },
      ],
    });
    assert.deepEqual(facts.ueno.shifts, [{ trainerName: "ひろむ", ranges: ["10:00–11:00", "18:00–19:00"] }]);
    assert.equal(facts.ueno.reservations, 1);
    assert.equal(facts.ueno.sameDayCancels, 1);
    assert.equal(facts.ueno.openSlots, 1);
  });
});

describe("isSameDayCancellation", () => {
  it("requires both the session and the cancel to fall on the report date", () => {
    assert.equal(
      isSameDayCancellation({
        dateYmd: "2026-10-30",
        startAt: "2026-10-30T01:00:00.000Z",
        updatedAt: "2026-10-29T10:00:00.000Z",
        status: "cancelled",
      }),
      false
    );
    assert.equal(
      isSameDayCancellation({
        dateYmd: "2026-10-30",
        startAt: "2026-10-31T01:00:00.000Z",
        updatedAt: "2026-10-30T10:00:00.000Z",
        notes: "same_day_cancel=no_show",
        status: "cancelled",
      }),
      false
    );
  });
});
