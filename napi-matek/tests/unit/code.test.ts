import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, formatCode, isWellFormedCode, normalizeCode } from "../../src/lib/auth/code.ts";

describe("belépőkód", () => {
  it("az ábécé 32 karakteres, és nincs benne 0, O, 1, I, l", () => {
    expect(CODE_ALPHABET.length).toBe(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const ch of "0O1Il") expect(CODE_ALPHABET.includes(ch)).toBe(false);
  });

  it("normalizál: nagybetű, kötőjel és szóköz nélkül", () => {
    expect(normalizeCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeCode("ab cd\tef–gh")).toBe("ABCDEFGH");
  });

  it("gépelés közben formáz, és 8 karakternél levág", () => {
    expect(formatCode("abc")).toBe("ABC");
    expect(formatCode("abcd")).toBe("ABCD");
    expect(formatCode("abcde")).toBe("ABCD-E");
    expect(formatCode("ABCD-EFGHXYZ")).toBe("ABCD-EFGH");
  });

  it("csak a helyes hosszú, megengedett karakterekből álló kódot fogadja el", () => {
    expect(isWellFormedCode("abcd-efgh")).toBe(true);
    expect(isWellFormedCode("ABCD-EFG")).toBe(false); // rövid
    expect(isWellFormedCode("ABCD-EFG0")).toBe(false); // 0 nem lehet
    expect(isWellFormedCode("ABCD-EFGI")).toBe(false); // I nem lehet
  });
});
