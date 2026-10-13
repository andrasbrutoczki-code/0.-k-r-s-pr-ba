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
    // A fotók a 3. lépésben közvetlenül a Storage-ba mennek, nem server actionön át;
    // a server actionök csak kis űrlapadatot kapnak.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
