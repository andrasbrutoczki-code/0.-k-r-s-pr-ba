import { describe, expect, it } from "vitest";
import { fitWithin } from "../../src/lib/images/compress.ts";

describe("képméret", () => {
  it("a hosszabbik oldal legfeljebb 1600 px, az arány megmarad, kicsit nem nagyít", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
