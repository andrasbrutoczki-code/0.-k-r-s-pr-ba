"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Beadott fotók: bélyegképek, kattintásra teljes képernyős nézet.
 * A nézetben: nagyítás (a képernyőhöz igazítva ↔ eredeti méret, görgethető),
 * forgatás 90°-onként (fekvő füzetfotókhoz), lapozás a nyilakkal, Esc bezár.
 */
export function ImageViewer({ images }: { images: { id: string; url: string }[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [rotation, setRotation] = useState(0);

  const current = images[index];

  function open(i: number) {
    setIndex(i);
    setZoomed(false);
    setRotation(0);
    dialogRef.current?.showModal();
  }

  function step(delta: number) {
    setIndex((i) => (i + delta + images.length) % images.length);
    setZoomed(false);
    setRotation(0);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (!dialog.open) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  if (images.length === 0) return null;

  const quarterTurn = rotation % 180 !== 0;

  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map((image, i) => (
          <li key={image.id}>
            <button
              type="button"
              onClick={() => open(i)}
              className="block w-full overflow-hidden rounded-md border border-rule bg-white"
              aria-label={`${i + 1}. fénykép megnyitása nagyban`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- lejáró aláírt URL */}
              <img src={image.url} alt="" className="aspect-[3/4] w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-graphite/95 p-0 backdrop:bg-black/60"
        aria-label="Beadott fénykép"
      >
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-center gap-2 bg-graphite p-2 text-white">
            <span className="px-2 text-sm">
              {index + 1} / {images.length}
            </span>
            {images.length > 1 ? (
              <>
                <button type="button" onClick={() => step(-1)} className="min-h-11 rounded px-3 hover:bg-white/10">
                  ← Előző
                </button>
                <button type="button" onClick={() => step(1)} className="min-h-11 rounded px-3 hover:bg-white/10">
                  Következő →
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => setZoomed((z) => !z)} className="min-h-11 rounded px-3 hover:bg-white/10">
              {zoomed ? "Képernyőhöz igazítás" : "Nagyítás (eredeti méret)"}
            </button>
            <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} className="min-h-11 rounded px-3 hover:bg-white/10">
              Forgatás ↻
            </button>
            <form method="dialog" className="ml-auto">
              <button className="min-h-11 rounded px-3 font-bold hover:bg-white/10">Bezárás ✕</button>
            </form>
          </div>
          <div className={`flex-1 overflow-auto ${zoomed ? "" : "flex items-center justify-center"}`}>
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element -- lejáró aláírt URL
              <img
                src={current.url}
                alt={`${index + 1}. beadott fénykép`}
                onClick={() => setZoomed((z) => !z)}
                style={{ transform: `rotate(${rotation}deg)` }}
                className={
                  zoomed
                    ? "max-w-none cursor-zoom-out"
                    : `cursor-zoom-in object-contain ${quarterTurn ? "max-h-[100vw] max-w-[100dvh]" : "max-h-full max-w-full"}`
                }
              />
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
