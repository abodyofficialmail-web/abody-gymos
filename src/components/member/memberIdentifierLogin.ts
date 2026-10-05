export async function loginWithMemberIdentifier(identifier: string): Promise<void> {
  const value = identifier.trim();
  if (!value) throw new Error("会員番号かメールアドレスを入力してください");
  const body = value.includes("@") ? { email: value } : { member_code: value.toUpperCase() };
  const res = await fetch("/api/member/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || "ログインに失敗しました");
}
