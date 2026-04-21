import { z } from 'zod';
/** 空き枠取得：dayIndex 必須、memberId/pin は任意（会員名返却用） */
export const availabilityRequestSchema = z.object({
  dayIndex: z.coerce.number().int().min(0).max(31),
  memberId: z.string().optional(),
  pin: z.string().optional(),
});
/** 予約：start/end は ISO 形式の文字列（厳密でない形式も許可） */
export const bookRequestSchema = z.object({
  memberId: z.string().min(1),
  pin: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
});
