import { describe, expect, it } from "vitest";
import { splitMath } from "../../src/lib/math-split.ts";

describe("képletek felbontása", () => {
  it("szöveg és soron belüli képlet", () => {
    expect(splitMath("Legyen $f(x) = x^2$ adott.")).toEqual([
      { kind: "text", value: "Legyen " },
      { kind: "math", value: "f(x) = x^2", display: false },
      { kind: "text", value: " adott." },
    ]);
  });

  it("kiemelt képlet", () => {
    expect(splitMath("A:\n$$\\int_0^1 x\\,dx$$\nkész")).toEqual([
      { kind: "text", value: "A:\n" },
      { kind: "math", value: "\\int_0^1 x\\,dx", display: true },
      { kind: "text", value: "\nkész" },
    ]);
  });

  it("\\$ szó szerinti dollárjel, a képleten belül is", () => {
    expect(splitMath("Ára 5 \\$.")).toEqual([{ kind: "text", value: "Ára 5 $." }]);
    expect(splitMath("$a = 5\\$$")).toEqual([{ kind: "math", value: "a = 5\\$", display: false }]);
  });

  it("lezáratlan képlet szövegként marad", () => {
    expect(splitMath("Hibás $x + 1 vége")).toEqual([{ kind: "text", value: "Hibás $x + 1 vége" }]);
  });

  it("több képlet egymás után, üres képlet kimarad", () => {
    expect(splitMath("$a$ és $$ $$$b$")).toEqual([
      { kind: "math", value: "a", display: false },
      { kind: "text", value: " és " },
      { kind: "math", value: "b", display: false },
    ]);
  });
});
