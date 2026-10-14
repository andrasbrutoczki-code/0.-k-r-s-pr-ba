import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext-beállítás a Cloudflare Workershez. Gyorsítótár (R2) nem kell:
 * minden oldal bejelentkezéshez kötött és dinamikus.
 */
export default defineCloudflareConfig();
