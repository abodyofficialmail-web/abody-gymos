import { getSheetsClient } from './google';
const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
/** 1枚のシート「data」で管理。A:F=会員(会員ID,名前,プラン,PIN,有効,メール), G:I=利用回数, K:P=予約ログ */
const DATA_SHEET = 'data';
const MEMBERS_RANGE = `${DATA_SHEET}!A2:F`;
const MEMBERS_APPEND_RANGE = `${DATA_SHEET}!A:F`;
const USAGE_RANGE = `${DATA_SHEET}!G2:I`;
const USAGE_APPEND_RANGE = `${DATA_SHEET}!G:I`;
const BOOKINGS_APPEND_RANGE = `${DATA_SHEET}!K:P`;
/** 予約ログ読み取り（リマインド用・Q列=リマインド送信済み、R列=キャンセル済み） */
const BOOKINGS_READ_RANGE = `${DATA_SHEET}!K2:R`;
/** 会員の予約一覧（マイカルテ用）。開始日時の新しい順。キャンセル済みは除外。 */
export interface MemberBooking {
  bookingId: string;
  memberId: string;
  start: string;
  end: string;
  createdAt: string;
}
export async function getBookingsByMemberId(memberId: string): Promise<MemberBooking[]> {
  const rows = await getSheetValues(BOOKINGS_READ_RANGE);
  const normalized = String(memberId || '').trim();
  const result: MemberBooking[] = [];
  for (const row of rows) {
    if (!row || row.length < 6) continue;
    if (String(row[7] || '').toUpperCase() === 'TRUE') continue; // R列=キャンセル済み
    const rowMemberId = String(row[1] || '').trim();
    if (rowMemberId !== normalized) continue;
    result.push({
      bookingId: String(row[0] || ''),
      memberId: rowMemberId,
      start: String(row[2] || ''),
      end: String(row[3] || ''),
      createdAt: String(row[5] || ''),
    });
  }
  result.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  return result;
}
/** 予約IDで予約行を取得（キャンセル用）。見つからなければ null。rowIndex は 2 始まり。 */
export async function getBookingRowByBookingId(bookingId: string): Promise<{
  rowIndex: number;
  eventId: string;
  memberId: string;
  start: string;
  end: string;
} | null> {
  const rows = await getSheetValues(BOOKINGS_READ_RANGE);
  const bid = String(bookingId || '').trim();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;
    if (String(row[7] || '').toUpperCase() === 'TRUE') continue;
    if (String(row[0] || '').trim() !== bid) continue;
    return {
      rowIndex: i + 2,
      eventId: String(row[4] || ''),
      memberId: String(row[1] || '').trim(),
      start: String(row[2] || ''),
      end: String(row[3] || ''),
    };
  }
  return null;
}
/** 予約ログの R 列（キャンセル済み）を TRUE にする */
export async function setBookingCancelled(rowIndex: number): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${DATA_SHEET}!R${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['TRUE']] },
  });
}
export interface Member {
  memberId: string;
  name: string;
  plan: '4' | '8' | 'unlimited';
  pin: string;
  active: boolean;
  email?: string;
}
export interface Usage {
  memberId: string;
  month: string; // YYYY-MM
  count: number;
}
export interface Booking {
  bookingId: string;
  memberId: string;
  start: string; // ISO
  end: string; // ISO
  eventId: string;
  createdAt: string; // ISO
}
async function getSheetValues(range: string): Promise<any[][]> {
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });
    const values = response.data.values || [];
    return values;
  } catch (error: any) {
    console.error('getSheetValues error:', error.message);
    throw error;
  }
}
async function appendToRange(range: string, values: any[]): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: {
      values: [values],
    },
  });
}
async function updateUsageRow(rowIndex: number, values: any[]): Promise<void> {
  const sheets = getSheetsClient();
  const row = rowIndex + 2; // データは2行目から
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${DATA_SHEET}!G${row}:I${row}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [values],
    },
  });
}
/** data シートの F 列を一括更新（1回の API 呼び出しでクォータを抑える） */
async function batchUpdateMemberEmailsInData(
  existingRows: any[][],
  memberIdToEmail: Map<string, string>
): Promise<number> {
  if (existingRows.length === 0) return 0;
  const values = existingRows.map((row) => {
    const memberId = String(row[0] || '').trim();
    const newEmail = memberIdToEmail.get(memberId);
    return [newEmail !== undefined && newEmail !== '' ? newEmail : (row[5] ?? '')];
  });
  const sheets = getSheetsClient();
  const endRow = existingRows.length + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${DATA_SHEET}!F2:F${endRow}`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
  return memberIdToEmail.size;
}
export async function getMember(memberId: string): Promise<Member | null> {
  try {
    const rows = await getSheetValues(MEMBERS_RANGE);
    for (const row of rows) {
      const rowMemberId = String(row[0] || '').trim();
      if (rowMemberId === memberId) {
        const member = {
          memberId: row[0],
          name: row[1] || '',
          plan: row[2] as '4' | '8' | 'unlimited',
          pin: String(row[3] || '').trim(),
          active: row[4] === 'TRUE' || row[4] === true || String(row[4] || '').toUpperCase() === 'TRUE',
          email: String(row[5] || '').trim() || undefined,
        };
        return member;
      }
    }
    return null;
  } catch (error) {
    console.error('getMember error:', error);
    return null;
  }
}
export async function getUsage(memberId: string, month: string): Promise<Usage | null> {
  const rows = await getSheetValues(USAGE_RANGE);
  for (const row of rows) {
    if (row[0] === memberId && row[1] === month) {
      return {
        memberId: row[0],
        month: row[1],
        count: parseInt(row[2] || '0', 10),
      };
    }
  }
  return null;
}
export async function incrementUsage(memberId: string, month: string): Promise<number> {
  const existing = await getUsage(memberId, month);
  if (existing) {
    const newCount = existing.count + 1;
    const rows = await getSheetValues(USAGE_RANGE);
    const rowIndex = rows.findIndex(row => row[0] === memberId && row[1] === month);
    if (rowIndex >= 0) {
      await updateUsageRow(rowIndex, [memberId, month, newCount]);
      return newCount;
    }
  }
  await appendToRange(USAGE_APPEND_RANGE, [memberId, month, 1]);
  return 1;
}
export async function createBooking(booking: Booking): Promise<void> {
  await appendToRange(BOOKINGS_APPEND_RANGE, [
    booking.bookingId,
    booking.memberId,
    booking.start,
    booking.end,
    booking.eventId,
    booking.createdAt,
  ]);
}
export interface BookingForReminder {
  bookingId: string;
  memberId: string;
  start: string;
  end: string;
  rowIndex: number;
}
/**
 * リマインド送信対象の予約を取得（開始が今〜24時間以内で、まだリマインド未送信のもの）。
 * 予約ログは K2 からなので rowIndex は 2 始まり。
 */
export async function getBookingsForReminder(): Promise<BookingForReminder[]> {
  const rows = await getSheetValues(BOOKINGS_READ_RANGE);
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  const result: BookingForReminder[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 6) continue;
    if (String(row[7] || '').toUpperCase() === 'TRUE') continue; // キャンセル済み除外
    const reminderSent = String(row[6] || '').toUpperCase() === 'TRUE';
    if (reminderSent) continue;
    const start = String(row[2] || '').trim();
    if (!start) continue;
    const startMs = new Date(start).getTime();
    if (Number.isNaN(startMs) || startMs < now || startMs > in24h) continue;
    result.push({
      bookingId: String(row[0] || ''),
      memberId: String(row[1] || ''),
      start,
      end: String(row[3] || ''),
      rowIndex: i + 2,
    });
  }
  return result;
}
/** 指定行のリマインド送信済みフラグを立てる（Q列） */
export async function markReminderSent(rowIndex: number): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${DATA_SHEET}!Q${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['TRUE']],
    },
  });
}
/** 4桁のPINを生成 */
export function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
/** 会員を追加（PIN自動生成、メール任意） */
export async function createMember(
  memberId: string,
  name: string,
  plan: '4' | '8' | 'unlimited',
  email?: string
): Promise<{ pin: string }> {
  const pin = generatePin();
  await appendToRange(MEMBERS_APPEND_RANGE, [
    memberId,
    name,
    plan,
    pin,
    'TRUE',
    email || '',
  ]);
  return { pin };
}
/** 既存会員を一括追加（無制限プラン、PIN自動生成） */
export async function createMembersBulk(
  members: { memberId: string; name: string; email?: string }[]
): Promise<{ created: number; pins: { memberId: string; pin: string }[] }> {
  const pins: { memberId: string; pin: string }[] = [];
  for (const m of members) {
    const pin = generatePin();
    await appendToRange(MEMBERS_APPEND_RANGE, [
      m.memberId,
      m.name,
      'unlimited',
      pin,
      'TRUE',
      m.email || '',
    ]);
    pins.push({ memberId: m.memberId, pin });
  }
  return { created: members.length, pins };
}
/** data の F 列 = 6列目（0始まりで index 5）をメールとして扱う */
const DATA_EMAIL_COLUMN_INDEX = 5;
/** ヘッダー行から列インデックスを取得（会員ID, 名前, メール）。メールは F 列相当をフォールバック */
function findMemberColumns(headers: string[]): { idCol: number; nameCol: number; emailCol: number } {
  let idCol = 0;
  let nameCol = 1;
  let emailCol: number | null = null;
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim().toLowerCase();
    if ((h.includes('会員') && (h.includes('id') || h.includes('番号'))) || h === 'memberid' || h === 'id') idCol = i;
    if (h.includes('名前') || h.includes('氏名') || h === 'name') nameCol = i;
    if (
      h.includes('メール') ||
      h.includes('mail') ||
      h === 'email' ||
      h.includes('アドレス') ||
      h.includes('e-mail') ||
      h.includes('連絡先')
    )
      emailCol = i;
  }
  if (emailCol === null && headers.length > DATA_EMAIL_COLUMN_INDEX) {
    emailCol = DATA_EMAIL_COLUMN_INDEX;
  }
  return { idCol, nameCol, emailCol: emailCol ?? DATA_EMAIL_COLUMN_INDEX };
}
/**
 * 指定シート（例: メンバーシート）の会員を data に反映。
 * 未登録は無制限プラン・PIN自動生成で追加。既存会員はスキップするが、メール列があれば data の F 列を更新する。
 * sourceSpreadsheetId を指定するとそのスプレッドシートから読む（未指定時は GOOGLE_SHEET_ID = data と同じブック）。
 */
export async function syncMembersFromSheet(
  sourceSheetName: string,
  sourceSpreadsheetId?: string
): Promise<{ synced: number; skipped: number; updated: number; pins: { memberId: string; pin: string }[] }> {
  const sheets = getSheetsClient();
  const bookId = sourceSpreadsheetId || SHEET_ID;
  // A:F を明示して F 列（メール）が必ず含まれるようにする
  const range = `'${sourceSheetName}'!A:F`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: bookId,
    range,
  });
  const rows = response.data.values || [];
  if (rows.length < 2) {
    return { synced: 0, skipped: 0, updated: 0, pins: [] };
  }
  const headers = rows[0].map((c: any) => String(c || '').trim());
  const { idCol, nameCol, emailCol } = findMemberColumns(headers);
  const existingRows = await getSheetValues(MEMBERS_RANGE);
  const existingIds = new Set(existingRows.map((r) => String(r[0] || '').trim()));
  const pins: { memberId: string; pin: string }[] = [];
  let synced = 0;
  let skipped = 0;
  const memberIdToEmail = new Map<string, string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const memberId = String(row[idCol] || '').trim();
    if (!memberId) continue;
    const name = String(row[nameCol] || '').trim() || memberId;
    // メンバーシート・data ともに F 列（index 5）= メール。F 列を最優先で読む
    const emailFromF = row.length > DATA_EMAIL_COLUMN_INDEX ? row[DATA_EMAIL_COLUMN_INDEX] : undefined;
    const emailRaw = emailFromF ?? row[emailCol];
    const email = String(emailRaw ?? '').trim();
    if (existingIds.has(memberId)) {
      skipped++;
      if (email) memberIdToEmail.set(memberId, email);
      continue;
    }
    const pin = generatePin();
    await appendToRange(MEMBERS_APPEND_RANGE, [
      memberId,
      name,
      'unlimited',
      pin,
      'TRUE',
      email || '',
    ]);
    existingIds.add(memberId);
    pins.push({ memberId, pin });
    synced++;
  }
  let updated = 0;
  if (memberIdToEmail.size > 0) {
    updated = await batchUpdateMemberEmailsInData(existingRows, memberIdToEmail);
  }
  return { synced, skipped, updated, pins };
}

