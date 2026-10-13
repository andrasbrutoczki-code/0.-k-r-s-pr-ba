import katex from "katex";
import { splitMath } from "@/lib/math-split";

/**
 * Feladatszöveg megjelenítése KaTeX-szel.
 *
 * Szerver- és kliensoldalon is használható (nincs állapota): a tanári
 * listában szerveren renderel, a szerkesztő élő előnézetében a böngészőben.
 *
 * Biztonság: a szövegrészek React szövegként (escape-elve) kerülnek ki; HTML
 * csak a KaTeX kimenetéből jön, `trust: false` mellett a KaTeX nem enged
 * \href-et, \url-t és egyéb aktív tartalmat. Hibás képletnél (throwOnError:
 * false) a KaTeX pirossal jelzi a hibát a szövegben, az oldal nem omlik össze.
 */
export function MathText({ source, className = "" }: { source: string; className?: string }) {
  const segments = splitMath(source);

  return (
    <div className={`math-text whitespace-pre-line ${className}`}>
      {segments.map((segment, index) => {
        if (segment.kind === "text") return <span key={index}>{segment.value}</span>;
        const html = katex.renderToString(segment.value, {
          displayMode: segment.display,
          throwOnError: false,
          strict: "ignore",
          trust: false,
          output: "htmlAndMathml",
        });
        return segment.display ? (
          <span key={index} className="my-2 block overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span key={index} dangerouslySetInnerHTML={{ __html: html }} />
        );
      })}
    </div>
  );
}
