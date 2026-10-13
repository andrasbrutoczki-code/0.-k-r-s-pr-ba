import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import "./globals.css";

/*
 * Atkinson Hyperlegible: gyengénlátók számára tervezett betűtípus, ahol a
 * hasonló jelek (I/l/1, O/0) szándékosan eltérnek – egy belépőkódokat és
 * képleteket mutató felületen ez funkció, nem díszítés. A latin-ext a
 * magyar ő/ű miatt kell.
 * A next/font a fontot buildkor letölti és saját domainről szolgálja ki:
 * a böngésző nem kér le semmit a Google-től (GDPR).
 */
const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Napi matek", template: "%s – Napi matek" },
  description: "Napi gyakorlófeladatok emelt szintű matematika érettségire.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbfcfe",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu" className={atkinson.variable}>
      <body>{children}</body>
    </html>
  );
}
