import type { NextConfig } from "next";

/**
 * Biztonsági fejlécek minden válaszhoz.
 * - A felület nem ágyazható be (clickjacking ellen).
 * - Referrer: más oldalra nem szivárog ki az útvonal (pl. tanuló-azonosító).
 * - A kamera csak saját origóról használható (a fotós feltöltéshez kell).
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // A feladat-ábrák (PNG, max. 5 MB) server actionön át mennek fel; a tanulói
    // fotók (3. lépés) közvetlenül a Storage-ba, nem az actionön keresztül.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
