import type { ReactNode } from "react";

function Pin({ n }: { n: number }) {
  return (
    <span className="mr-1 inline-grid h-[18px] w-[18px] place-items-center rounded-full bg-rose-600 align-middle text-[11px] font-extrabold text-white ring-[3px] ring-rose-600/15">
      {n}
    </span>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_1fr] items-start gap-2.5 text-[15px] leading-relaxed">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-rose-600 text-[13px] font-extrabold text-white">{n}</span>
      <div>{children}</div>
    </li>
  );
}

function Note({ tone = "warn", title, children }: { tone?: "warn" | "ok"; title: string; children: ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : "border-amber-200 bg-amber-50 text-amber-950";
  return (
    <div className={`mt-3 rounded-2xl border px-3.5 py-3 text-[13px] leading-relaxed ${cls}`}>
      <strong className="mb-0.5 block">{title}</strong>
      {children}
    </div>
  );
}

function Mock({
  title,
  pills,
  children,
}: {
  title: string;
  pills: Array<{ label: string; on?: boolean }>;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
          <div>
            <div className="text-[10px] font-bold tracking-wider text-slate-500">ABODY GYM OS</div>
            <div className="text-sm font-bold">{title}</div>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {pills.map((pill) => (
              <span
                key={pill.label}
                className={
                  pill.on
                    ? "rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white"
                    : "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700"
                }
              >
                {pill.label}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-2 p-3">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, value, pin }: { label: string; value: string; pin?: number }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold text-slate-700">
        {pin ? <Pin n={pin} /> : null}
        {label}
      </div>
      <div className="rounded-[10px] border border-slate-200 bg-white px-2.5 py-2 text-[13px]">{value}</div>
    </div>
  );
}

function Lesson({
  id,
  n,
  title,
  why,
  children,
  screen,
}: {
  id: string;
  n: number;
  title: string;
  why: string;
  children: ReactNode;
  screen: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 grid gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-2 lg:p-5">
      <div>
        <div className="mb-2 flex items-start gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-sm font-extrabold text-white">{n}</div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-slate-700">{why}</p>
        {children}
      </div>
      {screen}
    </section>
  );
}

const jumps = [
  { href: "#shift", n: "1", label: "シフト" },
  { href: "#break", n: "2", label: "休憩" },
  { href: "#stop-all", n: "3", label: "枠を止める" },
  { href: "#stop-one", n: "4", label: "この人だけ" },
  { href: "#ticket", n: "5", label: "チケット" },
];

const rows = [
  ["出勤時間を入れる", "シフト → その日", "右上の ＋ → 保存"],
  ["30分休んで、その枠を止める", "予約 → その日", "＋ 休憩追加"],
  ["長い時間、誰も予約できないようにする", "シフト → その日", "予定追加 → 枠を潰す"],
  ["連続で取りすぎる人に印を付ける", "会員 → プラン・予約制限", "予約止め提案中にする"],
  ["この会員だけ、その日を予約できないようにする", "会員 → プラン・予約制限", "この日を×"],
  ["チケットを足す", "会員 → プラン・予約制限", "付与"],
];

export function StaffManual() {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-slate-700">
        シフト、休憩、予約止め、チケット。赤い番号の場所を、上から順に押します。
      </p>

      <nav className="flex flex-wrap gap-2">
        {jumps.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-bold text-slate-800 hover:bg-slate-50"
          >
            <span className="mr-1.5 inline-grid h-[18px] w-[18px] place-items-center rounded-full bg-slate-900 text-[11px] text-white">
              {item.n}
            </span>
            {item.label}
          </a>
        ))}
      </nav>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">やりたいこと</th>
              <th className="px-4 py-3 font-semibold">開くメニュー</th>
              <th className="px-4 py-3 font-semibold">押すボタン</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t border-slate-200">
                <td className="px-4 py-3 font-bold">{row[0]}</td>
                <td className="px-4 py-3">{row[1]}</td>
                <td className="px-4 py-3">{row[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-2 md:hidden">
        {rows.map((row) => (
          <li key={row[0]} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="font-bold">{row[0]}</div>
            <div className="mt-1 text-sm text-slate-600">{row[1]}</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-900">{row[2]}</div>
          </li>
        ))}
      </ul>

      <Lesson
        id="shift"
        n={1}
        title="シフトを追加する"
        why="会員が予約できるのは、シフトを入れた時間だけです。先にシフトがないと、休憩も予約も入りません。"
        screen={
          <Mock title="11/3（火）" pills={[{ label: "シフト", on: true }, { label: "予約" }, { label: "会員" }]}>
            <div className="flex items-center justify-between">
              <div className="text-base font-extrabold">11/3（火）</div>
              <span className="rounded-xl bg-slate-900 px-3 py-2 text-[13px] font-extrabold text-white">
                <Pin n={3} />＋
              </span>
            </div>
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <strong>シフト追加</strong>
                <span className="text-[11px] text-slate-500">閉じる</span>
              </div>
              <div className="mb-2 text-[11px] text-slate-500">11月3日（火）</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="店舗" value="上野" pin={4} />
                <Field label="トレーナー" value="トレーナーA" />
                <Field label="開始" value="10:00" />
                <Field label="終了" value="19:00" />
              </div>
              <div className="mt-2">
                <Field label="休憩（分）" value="0" />
                <div className="mt-1 text-[11px] text-slate-500">給与からは差し引きません</div>
              </div>
              <div className="mt-2.5 rounded-xl bg-slate-900 py-2 text-center text-sm font-extrabold text-white">保存</div>
            </div>
          </Mock>
        }
      >
        <ol className="grid list-none gap-2.5 p-0">
          <Step n={1}>
            メニューから <strong>シフト</strong> を開く。
          </Step>
          <Step n={2}>
            カレンダーの <strong>日付</strong> をタップする。
          </Step>
          <Step n={3}>
            右上の <strong>＋</strong> を押す。
          </Step>
          <Step n={4}>
            店舗、トレーナー、開始、終了を入れて <strong>保存</strong>。
          </Step>
        </ol>
        <Note title="この画面の「休憩（分）」は、休む時間帯ではありません。">
          分数のメモで、給与からも引きません。何時の枠を止めるかは、次の「休憩」です。
        </Note>
      </Lesson>

      <Lesson
        id="break"
        n={2}
        title="休憩を入れる"
        why="30分だけ席を空けます。入れた時間は会員の予約画面から消え、予約一覧に休憩として残ります。"
        screen={
          <Mock title="予約" pills={[{ label: "シフト" }, { label: "予約", on: true }, { label: "会員" }]}>
            <div>
              <div className="font-extrabold">11/3（火）の予約</div>
              <div className="text-[11px] text-slate-500">カレンダーの日付をタップしたあと</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-950">
                <Pin n={3} />＋ 休憩追加
              </span>
              <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-bold">＋ 体験予約</span>
              <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-bold">＋ 会員予約</span>
            </div>
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <strong>休憩追加（30分）</strong>
                <span className="text-[11px] text-slate-500">閉じる</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="店舗" value="上野" />
                <Field label="日付" value="2026-11-03" />
              </div>
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <Field label="トレーナー（出勤シフト）" value="トレーナーA（10:00〜19:00）" pin={4} />
              </div>
              <div className="mb-1.5 mt-2 text-[11px] text-slate-500">休憩時間（30分）をタップ</div>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded-[10px] border border-slate-200 py-2 text-center text-xs font-bold">11:30〜12:00</div>
                <div className="rounded-[10px] border border-slate-900 bg-slate-900 py-2 text-center text-xs font-bold text-white">12:00〜12:30</div>
                <div className="rounded-[10px] border border-slate-200 py-2 text-center text-xs font-bold">12:30〜13:00</div>
              </div>
              <div className="mt-2.5 text-right">
                <span className="inline-block rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white">
                  <Pin n={5} />休憩を追加する
                </span>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-300 border-l-[6px] border-l-amber-500 bg-amber-50 px-3 py-2.5">
              <div className="font-extrabold text-amber-950">12:00〜12:30</div>
              <div className="text-[11px] font-bold text-amber-800">トレーナー休憩</div>
            </div>
          </Mock>
        }
      >
        <ol className="grid list-none gap-2.5 p-0">
          <Step n={1}>
            メニューの <strong>予約</strong> を開く。
          </Step>
          <Step n={2}>
            カレンダーで <strong>その日</strong> をタップする。
          </Step>
          <Step n={3}>
            <strong>＋ 休憩追加</strong> を押す。
          </Step>
          <Step n={4}>
            出勤中のトレーナーを選び、止める <strong>30分</strong> をタップする。
          </Step>
          <Step n={5}>
            <strong>休憩を追加する</strong> を押す。
          </Step>
        </ol>
        <Note tone="ok" title="入ったあとの見え方">
          その日の予約一覧の先頭あたりに、黄色い「トレーナー休憩」が出ます。例: 12:00〜12:30。
        </Note>
      </Lesson>

      <Lesson
        id="stop-all"
        n={3}
        title="長い時間の予約を止める"
        why="研修や打ち合わせなど、30分より長い時間を止めます。会員の予約画面から、その時間が消えます。"
        screen={
          <Mock title="11/3（火）" pills={[{ label: "シフト", on: true }]}>
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-3 py-2.5">
              <strong>予定</strong>
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold">
                <Pin n={2} />予定追加
              </span>
            </div>
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <strong>予定追加</strong>
                <span className="text-[11px] text-slate-500">閉じる</span>
              </div>
              <Field label="タイトル" value="研修" pin={3} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="店舗" value="上野" />
                <Field label="トレーナー" value="トレーナーA" />
                <Field label="開始" value="14:00" />
                <Field label="終了" value="16:00" />
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-rose-200 bg-rose-50 px-2 py-2 text-sm font-extrabold">
                <Pin n={4} />
                予約カレンダーの枠を潰す
              </div>
              <div className="mt-2.5 rounded-xl bg-slate-900 py-2 text-center text-sm font-extrabold text-white">
                <Pin n={5} />保存
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <strong>14:00〜16:00 / 研修</strong>
              <div className="text-[11px] text-slate-500">トレーナーA / 上野 / 予約を潰す</div>
            </div>
          </Mock>
        }
      >
        <ol className="grid list-none gap-2.5 p-0">
          <Step n={1}>
            <strong>シフト</strong> から、止めたい日を開く。
          </Step>
          <Step n={2}>
            下の方の <strong>予定追加</strong> を押す。
          </Step>
          <Step n={3}>タイトル、トレーナー、開始、終了を入れる。</Step>
          <Step n={4}>
            <strong>予約カレンダーの枠を潰す</strong> にチェックを入れる。
          </Step>
          <Step n={5}>
            <strong>保存</strong>。予定の下に「予約を潰す」と出れば止まっています。
          </Step>
        </ol>
        <Note title="チェックを外して保存すると、予定だけ残ります。">
          その時間は、会員が予約できるままです。枠を戻すときは、予定を開いてチェックを外すか、削除します。
        </Note>
      </Lesson>

      <Lesson
        id="stop-one"
        n={4}
        title="この会員だけ予約を止める"
        why="連続で取りすぎる人だけ、指定した日を止めます。回数の基準に達すると印が出ます。他の会員の空き表示は変わりません。"
        screen={
          <Mock title="会員" pills={[{ label: "会員", on: true }]}>
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-950">
              止め候補 先月12回・1週目4コマ
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-[10px] bg-slate-100 py-2 text-center text-xs font-bold text-slate-500">会員情報</div>
              <div className="rounded-[10px] border border-slate-200 bg-white py-2 text-center text-xs font-bold">
                <Pin n={2} />プラン・予約制限
              </div>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-950">
              <Pin n={3} />予約止め提案中
            </div>
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="text-[11px] font-bold text-slate-700">この人だけ翌日×</div>
              <div className="mb-2 text-[11px] text-slate-500">指定日だけ、この会員の予約画面が×になります。</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="制限する日" value="2026-11-04" pin={4} />
                <Field label="メモ" value="連続予約の調整" />
              </div>
              <div className="mt-2.5 inline-block rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white">
                <Pin n={5} />この日を×
              </div>
              <div className="mt-2.5 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div>
                  <strong>2026-11-04</strong> <span className="text-slate-500">連続予約の調整</span>
                </div>
                <span className="underline">解除</span>
              </div>
            </div>
          </Mock>
        }
      >
        <Note title="印の見方">
          カルテの一番上と、予約のその人の行に出ます。プラン・予約制限には、先月の回数と今月1日〜7日のコマ数も出ます。
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>
              <strong>止め候補 先月12回</strong>：先月の予約が12回以上。今月1日〜5日だけ出して、その間に止めます。1件を1回と数えます。60分でも1回です。
            </li>
            <li>
              <strong>止め候補 1週目4コマ</strong>：今月1日〜7日が4コマ以上。30分が1コマ、60分が2コマです。
            </li>
            <li>
              <strong>予約止め提案中</strong>：スタッフが「予約止め提案中にする」を押した状態です。
            </li>
            <li>
              <strong>予約止め中 11/04</strong>：その日を×にして、この会員だけ予約できない日です。
            </li>
          </ul>
          <div className="mt-1">12回未満、4コマ未満の人には、回数の印は出ません。数字が赤ければ基準以上です。</div>
        </Note>
        <Note title="止め方">
          印が出た人、または次のどれかに当てはまる人を止めます。
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>休みの日がなく、3日以上連続で予約している</li>
            <li>先の枠を、持てる上限いっぱいまでいつも埋めている</li>
            <li>同じ時間を毎日取って、他の会員がその時間に入れない</li>
          </ul>
          <div className="mt-1">週2〜3回で間に空いている日がある人は対象外です。今月の来店が少ない人は、予約を止めずに声をかけます。</div>
        </Note>
        <ol className="mt-3 grid list-none gap-2.5 p-0">
          <Step n={1}>
            メニューの <strong>会員</strong> から、その人を開く。
          </Step>
          <Step n={2}>
            <strong>プラン・予約制限</strong> を開く。
          </Step>
          <Step n={3}>
            <strong>予約止め提案中にする</strong> を押す。カルテの上と、予約のその人の行に赤い「予約止め提案中」が出ます。
          </Step>
          <Step n={4}>
            「この人だけ翌日×」で、<strong>制限する日</strong> を選ぶ。
          </Step>
          <Step n={5}>
            <strong>この日を×</strong> を押す。印に、止める日も出ます。
          </Step>
        </ol>
        <Note tone="ok" title="戻すとき">
          提案をやめるときは、同じ欄の <strong>やめる</strong> を押します。日付は、出ている行の <strong>解除</strong> を押すと、また予約できるようになります。
        </Note>
      </Lesson>

      <Lesson
        id="ticket"
        n={5}
        title="チケットを付与する"
        why="いつもの予約上限を超える分に使います。付与すると、会員の予約画面とマイページに残数が出ます。"
        screen={
          <Mock title="会員" pills={[{ label: "会員", on: true }]}>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-[10px] bg-slate-100 py-2 text-center text-xs font-bold text-slate-500">会員情報</div>
              <div className="rounded-[10px] border border-slate-200 bg-white py-2 text-center text-xs font-bold">
                <Pin n={2} />プラン・予約制限
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">残チケット: 2 コマ</div>
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="text-[11px] font-bold text-slate-700">チケット付与</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="コマ数" value="1" pin={3} />
                <Field label="メモ" value="来月先行案内" />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <span className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white">
                  <Pin n={4} />付与
                </span>
                <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold">1コマ減らす</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">11/02 14:10 +1 来月先行案内</div>
            </div>
          </Mock>
        }
      >
        <ol className="grid list-none gap-2.5 p-0">
          <Step n={1}>
            <strong>会員</strong> から、その人を開く。
          </Step>
          <Step n={2}>
            <strong>プラン・予約制限</strong> を開く。
          </Step>
          <Step n={3}>コマ数とメモを入れる。メモの初期値は「来月先行案内」です。</Step>
          <Step n={4}>
            <strong>付与</strong> を押す。上の「残チケット」が増えます。
          </Step>
        </ol>
        <Note title="入会のプレゼントは、ここではありません。">
          会員の新規登録にある「入会特典チケット」で、なし / 4〜8コマを選びます。減らすときは、同じ画面の「1コマ減らす」です。
        </Note>
      </Lesson>

      <p className="text-xs text-slate-500">画面の名前とボタンは管理画面と同じです。日付・店舗・トレーナーは見本です。</p>
    </div>
  );
}
