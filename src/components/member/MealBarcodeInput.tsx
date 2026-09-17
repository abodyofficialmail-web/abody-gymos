"use client";

import { useEffect, useRef, useState } from "react";

type NativeDetector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"] as const;

function NativeBarcodeDetector(): (new (opts?: { formats?: string[] }) => NativeDetector) | null {
  const Ctor = (window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeDetector })
    .BarcodeDetector;
  return Ctor ?? null;
}

function digitsFromScan(raw: string | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

async function createNativeDetector(): Promise<NativeDetector | null> {
  const Ctor = NativeBarcodeDetector();
  if (!Ctor) return null;
  const supportedFn = (
    Ctor as unknown as { getSupportedFormats?: () => Promise<string[]> }
  ).getSupportedFormats;
  let formats: string[] = [...NATIVE_FORMATS];
  if (typeof supportedFn === "function") {
    try {
      const supported = await supportedFn.call(Ctor);
      if (Array.isArray(supported) && supported.length) {
        formats = formats.filter((f) => supported.includes(f));
      }
    } catch {
      // keep defaults
    }
  }
  try {
    return formats.length ? new Ctor({ formats }) : new Ctor();
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

async function openCamera(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    { audio: false, video: { facingMode: { ideal: "environment" } } },
    { audio: false, video: true },
  ];
  let lastErr: unknown = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("camera");
}

async function widenCameraView(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities?.() as
    | { zoom?: { min?: number }; focusMode?: string[] }
    | undefined;
  const advanced: Record<string, unknown> = {};
  if (typeof caps?.zoom?.min === "number") advanced.zoom = caps.zoom.min;
  if (caps?.focusMode?.includes("continuous")) advanced.focusMode = "continuous";
  if (!Object.keys(advanced).length) return;
  try {
    await track.applyConstraints({ advanced: [advanced] } as MediaTrackConstraints);
  } catch {
    // some browsers reject zoom/focus even when advertised
  }
}

function drawVideoRegion(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  region: { x: number; y: number; w: number; h: number },
  maxWidth: number
) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;
  const sx = Math.max(0, Math.floor(vw * region.x));
  const sy = Math.max(0, Math.floor(vh * region.y));
  const sw = Math.max(1, Math.floor(vw * region.w));
  const sh = Math.max(1, Math.floor(vh * region.h));
  const scale = Math.min(1, maxWidth / sw);
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return true;
}

export function MealBarcodeInput({
  busy,
  onLookup,
}: {
  busy: boolean;
  onLookup: (barcode: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onLookupRef = useRef(onLookup);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  onLookupRef.current = onLookup;

  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    if (!video) {
      setScanErr("カメラ画面を開けませんでした。番号を入力してください。");
      setScanning(false);
      return;
    }

    let alive = true;
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement("canvas");
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;

    const finish = (raw: string) => {
      if (!alive) return;
      alive = false;
      setCode(raw);
      setScanning(false);
      try {
        navigator.vibrate?.(40);
      } catch {
        // ignore
      }
      onLookupRef.current(raw);
    };

    const stopTracks = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      video.srcObject = null;
    };

    (async () => {
      try {
        stream = await openCamera();
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        await widenCameraView(stream);
        video.srcObject = stream;
        await video.play();

        const detector = await createNativeDetector();
        const zxingMod = await import("@zxing/browser").catch(() => null);
        const library = await import("@zxing/library").catch(() => null);
        const hints = library ? new Map() : null;
        if (library && hints) {
          hints.set(library.DecodeHintType.POSSIBLE_FORMATS, [
            library.BarcodeFormat.EAN_13,
            library.BarcodeFormat.EAN_8,
            library.BarcodeFormat.UPC_A,
            library.BarcodeFormat.UPC_E,
            library.BarcodeFormat.CODE_128,
            library.BarcodeFormat.ITF,
          ]);
          hints.set(library.DecodeHintType.TRY_HARDER, true);
        }
        const reader =
          zxingMod?.BrowserMultiFormatReader && hints
            ? new zxingMod.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 })
            : null;

        if (!detector && !reader) {
          setScanErr("この端末ではカメラ読取が使えないため、下の番号入力を使ってください。");
          setScanning(false);
          return;
        }

        const regions = [
          { x: 0, y: 0, w: 1, h: 1 },
          { x: 0.02, y: 0.16, w: 0.96, h: 0.68 },
          { x: 0, y: 0.26, w: 1, h: 0.48 },
        ];
        const zxingEvery = detector ? 4 : 2;

        let tick = 0;
        const loop = async () => {
          if (!alive) return;
          tick += 1;
          try {
            if (video.readyState >= 2) {
              if (detector) {
                try {
                  const found = await detector.detect(video);
                  const raw = digitsFromScan(found[0]?.rawValue);
                  if (raw.length >= 8) {
                    finish(raw);
                    return;
                  }
                } catch {
                  // keep scanning
                }
              }
              if (reader && tick % zxingEvery === 0) {
                const region = regions[Math.floor(tick / zxingEvery) % regions.length] ?? regions[0];
                if (drawVideoRegion(video, canvas, region, 1280)) {
                  try {
                    const result = reader.decodeFromCanvas(canvas);
                    const raw = digitsFromScan(result?.getText());
                    if (raw.length >= 8) {
                      finish(raw);
                      return;
                    }
                  } catch {
                    // NotFoundException is normal
                  }
                }
              }
            }
          } catch {
            // keep scanning
          }
          if (alive) raf = requestAnimationFrame(() => void loop());
        };
        void loop();
      } catch {
        if (alive) {
          setScanning(false);
          setScanErr("カメラを起動できませんでした。番号を入力してください。");
        }
        stopTracks();
      }
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stopTracks();
    };
  }, [scanning]);

  return (
    <div className="space-y-3">
      <div className={scanning ? "fixed inset-0 z-50 bg-black" : "hidden"}>
        <video
          ref={videoRef}
          className="h-full w-full bg-black object-contain"
          muted
          playsInline
          autoPlay
        />
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute rounded-2xl border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]"
            style={{ left: "1.5%", right: "1.5%", top: "12%", bottom: "16%" }}
          />
          <div className="absolute left-0 right-16 top-[max(0.75rem,env(safe-area-inset-top))] px-4 text-center text-sm font-semibold text-white drop-shadow">
            バーコード全体が枠に入るようにしてください
          </div>
        </div>
        <button
          type="button"
          onClick={() => setScanning(false)}
          className="absolute right-3 top-[max(0.6rem,env(safe-area-inset-top))] z-10 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-900"
        >
          閉じる
        </button>
        <button
          type="button"
          onClick={() => setScanning(false)}
          className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900"
        >
          カメラを閉じる
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setScanErr(null);
            setScanning(true);
          }}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50"
        >
          カメラで読む
        </button>
        <button
          type="button"
          disabled={busy || code.replace(/\D/g, "").length < 8}
          onClick={() => onLookup(code)}
          className="rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "検索中…" : "番号で検索"}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        カメラは画面いっぱいに開き、できるだけ広い範囲から読み取ります。バーコード全体が見える距離で構いません。
      </p>
      <label className="block text-xs font-semibold text-slate-700">
        JAN / バーコード番号
        <input
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 14))}
          placeholder="4901234567890"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal tracking-wide"
        />
      </label>
      {scanErr ? <div className="text-xs text-amber-800">{scanErr}</div> : null}
    </div>
  );
}
