import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
let authClient: any = null;
function loadCredentialsFromJson(): { email: string; privateKey: string } | null {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (!jsonPath?.trim()) return null;
  const resolved = path.isAbsolute(jsonPath)
    ? jsonPath
    : path.join(process.cwd(), jsonPath);
  if (!fs.existsSync(resolved)) {
    console.warn('GOOGLE_SERVICE_ACCOUNT_JSON_PATH: file not found', resolved);
    return null;
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const json = JSON.parse(raw);
    const email = json.client_email?.trim();
    const privateKey = json.private_key?.trim();
    if (email && privateKey) return { email, privateKey };
  } catch (e) {
    console.error('Failed to read service account JSON:', e);
  }
  return null;
}
export function getAuthClient() {
  if (authClient) {
    return authClient;
  }
  // 1) JSON ファイルから読む（推奨・DECODER エラーを避けられる）
  const fromFile = loadCredentialsFromJson();
  if (fromFile) {
    try {
      authClient = new google.auth.JWT({
        email: fromFile.email,
        key: fromFile.privateKey,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/spreadsheets',
        ],
      });
      console.log('Auth setup: using GOOGLE_SERVICE_ACCOUNT_JSON_PATH');
      return authClient;
    } catch (err: any) {
      console.error('Auth from JSON failed:', err?.message);
      throw new Error(
        'サービスアカウントJSONの読み込みに失敗しました。GOOGLE_SERVICE_ACCOUNT_JSON_PATH のファイルを確認してください。'
      );
    }
  }
  // 2) .env の EMAIL + PRIVATE_KEY から読む
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim() || '';
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1).trim();
  }
  privateKey = privateKey.replace(/\r/g, '');
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  // Vercel などで改行が消えたり1行で貼られた場合に PEM 形式に正規化
  const pemTypes = [
    { begin: '-----BEGIN PRIVATE KEY-----', end: '-----END PRIVATE KEY-----' },
    { begin: '-----BEGIN RSA PRIVATE KEY-----', end: '-----END RSA PRIVATE KEY-----' },
  ] as const;
  for (const { begin, end } of pemTypes) {
    if (!privateKey.includes(begin) || !privateKey.includes(end)) continue;
    const start = privateKey.indexOf(begin) + begin.length;
    const finish = privateKey.indexOf(end);
    // 改行・空白を除去し、Base64 以外の文字も除去（Vercel で壊れた場合に備える）
    const raw = privateKey.slice(start, finish).replace(/\s/g, '');
    const base64 = raw.replace(/[^A-Za-z0-9+/=]/g, '');
    if (base64.length < 100) continue; // 短すぎる場合は別形式を試す
    const lines: string[] = [];
    for (let i = 0; i < base64.length; i += 64) {
      lines.push(base64.slice(i, i + 64));
    }
    privateKey = `${begin}\n${lines.join('\n')}\n${end}`;
    break;
  }
  if (!email || !privateKey) {
    throw new Error(
      'Google の認証情報がありません。.env.local に GOOGLE_SERVICE_ACCOUNT_EMAIL と GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY を入れるか、GOOGLE_SERVICE_ACCOUNT_JSON_PATH で JSON ファイルを指定してください。'
    );
  }
  try {
    authClient = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('DECODER') || msg.includes('PEM') || msg.includes('key')) {
      throw new Error(
        '秘密鍵の形式エラーです。Google Cloud でサービスアカウントの「鍵」→ JSON をダウンロードし、プロジェクト直下に service-account.json として保存して、.env.local に GOOGLE_SERVICE_ACCOUNT_JSON_PATH=service-account.json を追加してください。'
      );
    }
    throw err;
  }
  return authClient;
}
export function getCalendarClient() {
  const auth = getAuthClient();
  return google.calendar({ version: 'v3', auth });
}
export function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: 'v4', auth });
}
