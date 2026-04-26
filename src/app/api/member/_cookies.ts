import { cookies } from "next/headers";

const COOKIE_NAME = "member_id";

export function getMemberIdFromCookie(): string | null {
  const v = cookies().get(COOKIE_NAME)?.value ?? null;
  return v && v.trim() ? v : null;
}

export function setMemberIdCookie(memberId: string) {
  const secure = process.env.NODE_ENV === "production";
  cookies().set({
    name: COOKIE_NAME,
    value: memberId,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90日
  });
}

export function clearMemberIdCookie() {
  cookies().set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

