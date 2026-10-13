import { describe, expect, it } from "vitest";
import { decodeJwtPayload, sessionIdFromAccessToken } from "../../src/lib/auth/jwt.ts";

/** Aláírás nélküli teszttoken (a dekódoló úgysem ellenőriz aláírást). */
function token(payload: object): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.signature`;
}

describe("JWT payload", () => {
  it("kiolvassa a session_id-t", () => {
    const id = "6f1d2c3b-1111-4222-8333-944455556666";
    expect(sessionIdFromAccessToken(token({ sub: "x", session_id: id }))).toBe(id);
  });

  it("ékezetes, base64url-kódolt (- és _) tartalmat is helyesen dekódol", () => {
    const payload = { név: "Ánya?>>>", n: "~~~???" };
    expect(decodeJwtPayload(token(payload))).toEqual(payload);
  });

  it("hiányzó vagy hibás session_id esetén null", () => {
    expect(sessionIdFromAccessToken(token({ sub: "x" }))).toBeNull();
    expect(sessionIdFromAccessToken(token({ session_id: "nem-uuid" }))).toBeNull();
    expect(sessionIdFromAccessToken("nem.jwt")).toBeNull();
    expect(sessionIdFromAccessToken("")).toBeNull();
  });
});
