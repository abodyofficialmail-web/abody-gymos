import nodemailer from 'nodemailer';
/**
 * SMTP トランスポートを取得。
 * SMTP_HOST があれば送信可能。SMTP_USER / SMTP_PASS は任意（未設定なら認証なしで送信）。
 */
function getTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const options = {
    host,
    port: port ? parseInt(port, 10) : 587,
    secure: process.env.SMTP_SECURE === 'true',
    ...(user && pass ? { auth: { user, pass } } : {}),
  };
  return nodemailer.createTransport(options as nodemailer.TransportOptions);
}
/** 店舗情報・ルール・LINE（予約メール・リマインド共通） */
const EMAIL_FOOTER = `
【店舗住所】
Abody上野店
東京都台東区台東4-31-5
オリオンビル4F
※1階に「美容室eight」が入っているビルです
美容室横の通路からエレベーターで4階へお上がりください
【ご利用時のお願い】
快適にご利用いただくため、以下のルールにご協力をお願いいたします。
・飲み物は各自ご持参ください
・利用後は器具をアルコールティッシュで拭いてください
・激しい音楽は禁止です
・ジャンプ動作は禁止です（下階への振動防止のため）
・ダンベルやラックは丁寧に置くようにして元の位置へ戻してください
・ゴミは各自でお持ち帰りください
・ブース内での食事は禁止です
・プロテインはシンクに流さないでください
・ジム内の備品には許可なく触れないでください
・器具の破損があった場合は必ずご報告ください（故意・過失に関わらず弁償対象となります）
※騒音・振動について下の階からクレームが入ることがあるため、ご配慮をお願いいたします。
ご不明点がございましたらお気軽にAbody公式ラインからご連絡ください
上野店公式ラインはこちら👇
https://lin.ee/LJ8LvRo
ご理解とご協力をお願いいたします。
当日のご利用をお待ちしております。
Abody上野店
`.trim();
/**
 * 予約確定メールを送信。SMTP未設定の場合は送信せず false を返す。
 */
export async function sendBookingConfirmation(params: {
  to: string;
  memberName: string;
  dateStr: string;
  timeStr: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('SMTP not configured, skipping confirmation email');
    return false;
  }
  // 送信元は基本 MAIL_FROM。未設定の場合は運用用の ABODY_EMAIL をフォールバックとして使えるようにする。
  // ※ 実際に送信できる送信元は SMTP 側の制約（認証ユーザー/ドメイン）にも依存する。
  const from = process.env.MAIL_FROM || process.env.ABODY_EMAIL || process.env.SMTP_USER || 'noreply@localhost';
  if (!from) {
    console.warn('MAIL_FROM / SMTP_USER not set, using default from address');
  }
  const subject = '【Abodyジム】予約が確定しました';
  const text = `
${params.memberName} 様
この度はAbody上野店の個室ジム利用をご予約いただきありがとうございます。
以下の日程で予約が確定しました。
――――――――――
【予約内容】
日付：${params.dateStr}
時間：${params.timeStr}
――――――――――
${EMAIL_FOOTER}
`;
  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject,
      text: text.trim(),
    });
    return true;
  } catch (err: any) {
    console.error('Send confirmation email failed:', err?.message);
    return false;
  }
}
/**
 * キャンセル通知メールを会員とAbodyに送信。
 */
export async function sendCancellationEmail(params: {
  memberEmail: string;
  memberName: string;
  dateStr: string;
  timeStr: string;
  abodyEmail?: string;
}): Promise<{ member: boolean; abody: boolean }> {
  const transporter = getTransporter();
  const from = process.env.MAIL_FROM || process.env.ABODY_EMAIL || process.env.SMTP_USER || 'noreply@localhost';
  const subject = '【Abodyジム】予約がキャンセルされました';
  const textToMember = `
${params.memberName} 様
以下の日程のAbody上野店ジム利用予約がキャンセルされました。
――――――――――
【キャンセルした予約】
日付：${params.dateStr}
時間：${params.timeStr}
――――――――――
再度ご予約の場合は予約ページよりお手続きください。
${EMAIL_FOOTER}
`;
  const result = { member: false, abody: false };
  if (transporter) {
    try {
      await transporter.sendMail({
        from: from!,
        to: params.memberEmail,
        subject,
        text: textToMember.trim(),
      });
      result.member = true;
    } catch (err: any) {
      console.error('Send cancellation email to member failed:', err?.message);
    }
    const abodyTo = params.abodyEmail || process.env.ABODY_EMAIL;
    if (abodyTo) {
      try {
        const textToAbody = `
【予約キャンセル通知】
会員名：${params.memberName}
会員メール：${params.memberEmail}
日付：${params.dateStr}
時間：${params.timeStr}
上記の予約がキャンセルされました。
`.trim();
        await transporter.sendMail({
          from: from!,
          to: abodyTo,
          subject: `【Abodyジム】予約キャンセル ${params.memberName} 様`,
          text: textToAbody,
        });
        result.abody = true;
      } catch (err: any) {
        console.error('Send cancellation email to Abody failed:', err?.message);
      }
    }
  }
  return result;
}
/**
 * リマインドメールを送信。SMTP未設定の場合は送信せず true を返す。
 */
export async function sendReminderEmail(params: {
  to: string;
  memberName: string;
  dateStr: string;
  timeStr: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('SMTP not configured, skipping reminder email');
    return true;
  }
  const from = process.env.MAIL_FROM || process.env.ABODY_EMAIL || process.env.SMTP_USER || 'noreply@localhost';
  const subject = '【Abodyジム】ご予約のリマインド';
  const text = `
${params.memberName} 様
ご予約のリマインドです。
以下の日程でAbody上野店の個室ジムをご予約いただいております。
――――――――――
【予約内容】
日付：${params.dateStr}
時間：${params.timeStr}
――――――――――
${EMAIL_FOOTER}
`;
  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject,
      text: text.trim(),
    });
    return true;
  } catch (err: any) {
    console.error('Send reminder email failed:', err?.message);
    return false;
  }
}

/**
 * 店舗ごとの日次予約レポート（管理者向け）を送信。
 * SMTP未設定の場合は送信せず false を返す。
 */
export async function sendDailyStoreReservationReport(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("SMTP not configured, skipping daily report email");
    return false;
  }
  const from = process.env.MAIL_FROM || process.env.ABODY_EMAIL || process.env.SMTP_USER || "noreply@localhost";
  try {
    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
    return true;
  } catch (err: any) {
    console.error("Send daily report email failed:", err?.message);
    return false;
  }
}
