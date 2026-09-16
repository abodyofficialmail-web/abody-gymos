"use client";

import { useEffect, useRef, useState } from "react";

type NativeDetector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function NativeBarcodeDetector(): (new (opts?: { formats?: string[] }) => NativeDetector) | null {
  const Ctor = (window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeDetector })
    .BarcodeDetector;
  return Ctor ?? null;
}

export function MealBarcodeInput({
  busy,
  onLookup,
}: {
  busy: boolean;
  onLookup: (barcode: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

  async function stopScan() {
    stopRef.current?.();
    stopRef.current = null;
    setScanning(false);
  }

  async function startScan() {
    setScanErr(null);
    const video = videoRef.current;
    if (!video) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      setScanning(true);

      const Detector = NativeBarcodeDetector();
      if (Detector) {
        const detector = new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
        let alive = true;
        const tick = async () => {
          if (!alive) return;
          try {
            const found = await detector.detect(video);
            const raw = found[0]?.rawValue?.replace(/\D/g, "") ?? "";
            if (raw.length >= 8) {
              alive = false;
              setCode(raw);
              await stopScan();
              onLookup(raw);
              return;
            }
          } catch {
            // keep scanning
          }
          if (alive) requestAnimationFrame(() => void tick());
        };
        stopRef.current = () => {
          alive = false;
          stream.getTracks().forEach((t) => t.stop());
          video.srcObject = null;
        };
        void tick();
        return;
      }

      const zxing = await import("@zxing/browser").catch(() => null);
      if (zxing?.BrowserMultiFormatReader) {
        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          const raw = result?.getText()?.replace(/\D/g, "") ?? "";
          if (raw.length >= 8) {
            setCode(raw);
            void stopScan();
            onLookup(raw);
          }
        });
        stopRef.current = () => {
          controls.stop();
          stream.getTracks().forEach((t) => t.stop());
          video.srcObject = null;
        };
        return;
      }

      stopRef.current = () => {
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      };
      setScanErr("この端末ではカメラ読取が使えないため、下の番号入力を使ってください。");
    } catch {
      setScanning(false);
      setScanErr("カメラを起動できませんでした。番号を入力してください。");
    }
  }

  return (
    <div className="space-y-3">
      <video
        ref={videoRef}
        className={scanning ? "h-48 w-full rounded-xl bg-black object-cover" : "hidden"}
        muted
        playsInline
      />
      <div className="grid grid-cols-2 gap-2">
        {scanning ? (
          <button
            type="button"
            onClick={() => void stopScan()}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800"
          >
            カメラを止める
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startScan()}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50"
          >
            カメラで読む
          </button>
        )}
        <button
          type="button"
          disabled={busy || code.replace(/\D/g, "").length < 8}
          onClick={() => onLookup(code)}
          className="rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "検索中…" : "番号で検索"}
        </button>
      </div>
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
