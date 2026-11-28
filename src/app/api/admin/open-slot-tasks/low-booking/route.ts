import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { listStoreLowBookingMembers } from "@/lib/storeLowBookingMembers";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const storeId = new URL(request.url).searchParams.get("store_id") ?? "";
    if (!z.string().uuid().safeParse(storeId).success) {
      return jsonResponse({ error: "店舗を確認してください" }, 400);
    }
    const listed = await listStoreLowBookingMembers(createSupabaseServiceClient(), storeId);
    return jsonResponse({
      month_label: listed.monthLabel,
      members: listed.members.map((member) => ({
        id: member.id,
        member_code: member.memberCode,
        name: member.name,
        count: member.count,
        has_line: member.hasLine,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "予約が少ない会員の取得に失敗しました", detail: message }, 500);
  }
}
