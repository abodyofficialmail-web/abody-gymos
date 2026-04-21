/** Google API などから返る英語メッセージを日本語に変換 */
const EN_TO_JA: Record<string, string> = {
  'The caller does not have permission': 'このスプレッドシートをサービスアカウントと「編集者」で共有してください。',
  'caller does not have permission': 'このスプレッドシートをサービスアカウントと「編集者」で共有してください。',
  'Permission denied': '権限がありません。スプレッドシート・カレンダーをサービスアカウントと共有してください。',
  'Not Found': 'スプレッドシートまたはカレンダーが見つかりません。IDを確認してください。',
  'Invalid credentials': '認証に失敗しました。サービスアカウントの設定を確認してください。',
  'Request had invalid authentication credentials': '認証に失敗しました。サービスアカウントの設定を確認してください。',
  'The request is missing a valid API key': 'APIキーが設定されていません。',
  'Calendar not found': 'カレンダーが見つかりません。カレンダーIDと共有設定を確認してください。',
  'Spreadsheet not found': 'スプレッドシートが見つかりません。シートIDと共有設定を確認してください。',
  'Invalid value': 'カレンダーまたは日時の形式が正しくありません。',
  'The requested minimum modification time': 'カレンダーの取得に失敗しました。',
  'not found': 'カレンダーまたはスプレッドシートが見つかりません。IDと共有設定を確認してください。',
};
/** Google API のエラーオブジェクトからメッセージ文字列を取得 */
export function getErrorMessage(err: any): string {
  if (!err) return '';
  const msg = err?.message ?? err?.response?.data?.error?.message ?? err?.response?.data?.error ?? '';
  return String(msg).trim();
}
export function toJapaneseError(message: string | undefined): string {
  if (!message) return 'エラーが発生しました。';
  const trimmed = message.trim();
  for (const [en, ja] of Object.entries(EN_TO_JA)) {
    if (trimmed.includes(en)) return ja;
  }
  return trimmed;
}
