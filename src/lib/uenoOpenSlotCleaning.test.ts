import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUenoStoreName,
  pickPhotoStepKeys,
  uenoCleaningPhotoSlots,
  validateUenoCleaningSubmission,
} from "./uenoOpenSlotCleaning.ts";

const SLOT = "2026-11-28T05:00:00.000Z";

describe("ueno open slot cleaning", () => {
  it("recognizes the Ueno store name", () => {
    assert.equal(isUenoStoreName("上野"), true);
    assert.equal(isUenoStoreName("上野店"), true);
    assert.equal(isUenoStoreName("新宿"), false);
  });

  it("picks the same three steps for the same slot", () => {
    const keys = ["prep", "vacuum", "roller", "wipe", "corners", "restore", "gear", "trash", "dumbbell", "final", "vacuum-bin"];
    const first = pickPhotoStepKeys(`${SLOT}|booth`, keys, 3);
    const second = pickPhotoStepKeys(`${SLOT}|booth`, keys, 3);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, 3);
    assert.ok(first.every((key) => keys.includes(key)));
  });

  it("asks both booths for the same three photos", () => {
    const slots = uenoCleaningPhotoSlots("booth", SLOT);
    assert.equal(slots.length, 6);
    const booth1 = slots.filter((slot) => slot.placeKey === "booth1").map((slot) => slot.stepKey);
    const booth2 = slots.filter((slot) => slot.placeKey === "booth2").map((slot) => slot.stepKey);
    assert.deepEqual(booth1, booth2);
  });

  it("requires one photo for each shorter place", () => {
    const slots = uenoCleaningPhotoSlots("kitchen", SLOT);
    assert.deepEqual(
      slots.map((slot) => slot.placeKey),
      ["kitchen", "fridge"]
    );
    assert.ok(slots.every((slot) => slot.stepKey === "place"));
  });

  it("rejects a booth report until the picked photos are attached", () => {
    const slots = uenoCleaningPhotoSlots("booth", SLOT);
    const checks = ["booth1", "booth2"].flatMap((placeKey) =>
      ["prep", "vacuum", "roller", "wipe", "corners", "restore", "gear", "trash", "dumbbell", "final", "vacuum-bin"].map((stepKey) => ({
        placeKey,
        stepKey,
        done: true,
      }))
    );
    const missing = validateUenoCleaningSubmission({ areaKey: "booth", slotStart: SLOT, checks, photos: [] });
    assert.equal(missing.ok, false);

    const photos = slots.map((slot) => ({ placeKey: slot.placeKey, stepKey: slot.stepKey }));
    const ready = validateUenoCleaningSubmission({
      areaKey: "booth",
      slotStart: SLOT,
      checks,
      photos,
      note: "問題なし",
    });
    assert.equal(ready.ok, true);
    if (ready.ok) {
      assert.match(ready.detail, /今回の写真:/);
      assert.match(ready.detail, /問題なし/);
      assert.equal(ready.taskLabel, "掃除（ブース1、ブース2）");
    }
  });
});
