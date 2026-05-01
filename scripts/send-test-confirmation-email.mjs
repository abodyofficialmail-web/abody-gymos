import nodemailer from "nodemailer";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const options = {
    host,
    port: port ? parseInt(port, 10) : 587,
    secure: process.env.SMTP_SECURE === "true",
    ...(user && pass ? { auth: { user, pass } } : {}),
  };
  return nodemailer.createTransport(options);
}

async function main() {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error(
      "SMTP_HOST が未設定のため送信できません。.env.local に SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE / MAIL_FROM を設定してください。"
    );
  }

  const to = process.env.TEST_MAIL_TO?.trim();
  if (!to) throw new Error("TEST_MAIL_TO が未設定です（例: kazuhiko324hiko@gmail.com）");

  const from = process.env.MAIL_FROM || process.env.ABODY_EMAIL || process.env.SMTP_USER || "noreply@localhost";
  const subject = "【Abodyジム】予約が確定しました（テスト送信）";
  const text = `
テスト送信です。
宛先: ${to}
送信元: ${from}
`.trim();

  await transporter.sendMail({ from, to, subject, text });
  console.log("test email sent", { from, to });
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

