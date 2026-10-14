import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ImportFormatError,
  matchTopic,
  parseCsv,
  parseCsvImport,
  parseJsonImport,
} from "../../src/lib/import/parse.ts";

const topics = [
  ["abszolutertek-gyok", "Abszolútérték, gyök"],
  ["egyenletek", "Egyenletek, egyenlőtlenségek, egyenletrendszerek"],
  ["egyszerusites", "Egyszerűsítés, átalakítás"],
  ["fuggvenytulajdonsagok", "Függvénytulajdonságok és -transzformációk"],
  ["exponencialis", "Exponenciális feladatok"],
  ["logaritmus", "Logaritmusos feladatok"],
  ["fuggvenyanalizis", "Függvényanalízis"],
  ["halmazok", "Halmazok"],
  ["koordinatageom", "Koordinátageometria"],
  ["logika", "Logika"],
  ["grafok", "Gráfok"],
  ["sikgeometria", "Síkgeometria"],
  ["tergeometria", "Térgeometria"],
  ["sorozatok", "Sorozatok"],
  ["sorozat-hatarertek", "Sorozat határértéke"],
  ["statisztika", "Statisztika"],
  ["szamelmelet", "Számelmélet"],
  ["trigonometria", "Trigonometria"],
  ["valoszinusegszamitas", "Valószínűségszámítás"],
  ["kombinatorika", "Kombinatorika"],
  ["szelsoertek", "Szélsőértékkeresés"],
  ["hatarozott-integral", "Határozott integrál"],
  ["hatarozatlan-integral", "Határozatlan integrál"],
].map(([slug, name]) => ({ slug: slug!, name: name! }));

describe("témakör-egyeztetés", () => {
  it("slug, név, ékezet nélkül és egyértelmű kezdet", () => {
    expect(matchTopic("egyenletek", topics)?.slug).toBe("egyenletek");
    expect(matchTopic("Síkgeometria", topics)?.slug).toBe("sikgeometria");
    expect(matchTopic("valószínűségszámítás", topics)?.slug).toBe("valoszinusegszamitas");
    expect(matchTopic("loga", topics)?.slug).toBe("logaritmus");
    expect(matchTopic("ko", topics)).toBeNull(); // Koordinátageometria és Kombinatorika: nem egyértelmű
  });

  it("több témakör: „|” vagy „;” jellel, JSON-tömbként; az első az elsődleges", () => {
    const rows = parseJsonImport(
      JSON.stringify([
        { cim: "A", szoveg: "x", temakor: "logaritmus|exponencialis", nehezseg: 2 },
        { cim: "B", szoveg: "x", temakor: ["Síkgeometria", "kombinatorika", "sikgeometria"], nehezseg: 2 },
        { cim: "C", szoveg: "x", temakor: "egyenletek; nincs-ilyen", nehezseg: 2 },
      ]),
      { topics },
    );
    expect(rows[0]!.row?.topic_slugs).toEqual(["logaritmus", "exponencialis"]);
    expect(rows[1]!.row?.topic_slugs).toEqual(["sikgeometria", "kombinatorika"]);
    expect(rows[2]!.errors.length).toBe(1);
  });
});

describe("JSON import", () => {
  it("a JSON mintafájl hibátlan, a tesztfeladat helyes válasza átjön", () => {
    const text = readFileSync(new URL("../../public/mintak/feladatok-minta.json", import.meta.url), "utf8");
    const rows = parseJsonImport(text, { topics });
    expect(rows.length).toBe(21);
    expect(rows[20]!.row?.correct_choice).toBe("B");
    expect(rows.filter((r) => r.errors.length > 0).length).toBe(0);
    expect(rows.every((r) => r.row !== undefined)).toBe(true);
  });

  it("hibás sorokat jelez, a jókat megtartja", () => {
    const rows = parseJsonImport(
      JSON.stringify([
        { cim: "Jó", szoveg: "$x$", temakor: "egyenletek", nehezseg: 2 },
        { cim: "", szoveg: "", temakor: "nincs", nehezseg: 9, kep_kell: "talán" },
        { "Cím": "Ábrás", "Szöveg": "a", "Témakör": "Síkgeometria", "Nehézség": "3", "ábra": "a.png", pontszam: 5 },
      ]),
      { topics },
    );
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[1]!.errors.length).toBe(5);
    expect(rows[2]!.errors).toEqual(["Ábrát csak ZIP-csomagban (JSON/CSV + PNG) lehet importálni."]);
    expect(rows[2]!.warnings).toEqual(["A pontszámot nem használjuk, figyelmen kívül hagyjuk."]);
  });

  it("ZIP-ben az ábra hivatkozás ellenőrzött", () => {
    const base = { cim: "A", szoveg: "a", temakor: "sikgeometria", nehezseg: 1 };
    const rows = parseJsonImport(
      JSON.stringify({ feladatok: [{ ...base, abra: "van.png" }, { ...base, cim: "B", abra: "nincs.png" }] }),
      { topics, figures: new Set(["van.png"]) },
    );
    expect(rows[0]!.row?.figure).toBe("van.png");
    expect(rows[1]!.errors).toEqual(["Az ábrafájl nincs a ZIP-ben: „nincs.png”."]);
  });

  it("formai hibák", () => {
    let thrown: unknown;
    try {
      parseJsonImport("{ nem json", { topics });
    } catch (err) {
      thrown = err;
    }
    expect(thrown instanceof ImportFormatError).toBe(true);
  });
});

describe("típus és idő az importban", () => {
  it("teszt felismerése, alapból nem kér képet; ismeretlen típus hiba", () => {
    const rows = parseJsonImport(
      JSON.stringify([
        { cim: "A", szoveg: "Melyik?\n(A) 1\n(B) 2", temakor: "egyenletek", nehezseg: 1 },
        { cim: "B", szoveg: "x", temakor: "egyenletek", nehezseg: 2, tipus: "kifejtős", ido_perc: 15 },
        { cim: "C", szoveg: "x", temakor: "egyenletek", nehezseg: 2, tipus: "esszé", ido_perc: 500 },
      ]),
      { topics },
    );
    expect(rows[0]!.row?.task_type).toBe("teszt");
    expect(rows[0]!.row?.requires_image).toBe(false);
    expect(rows[1]!.row?.task_type).toBe("kifejtos");
    expect(rows[1]!.row?.requires_image).toBe(true);
    expect(rows[1]!.row?.est_minutes).toBe(15);
    expect(rows[2]!.errors.length).toBe(2);
  });

  it("helyes válasz: megadva, útmutatóból kiolvasva, hibás, nem teszthez", () => {
    const rows = parseJsonImport(
      JSON.stringify([
        { cim: "A", szoveg: "(A) 1 (B) 2", temakor: "egyenletek", nehezseg: 1, helyes: "(b)" },
        { cim: "B", szoveg: "(A) 1 (B) 2", temakor: "egyenletek", nehezseg: 1, megoldasi_utmutato: "Helyes válasz: (A) 1." },
        { cim: "C", szoveg: "(A) 1 (B) 2", temakor: "egyenletek", nehezseg: 1, helyes: "X" },
        { cim: "D", szoveg: "x", temakor: "egyenletek", nehezseg: 1, tipus: "kifejtos", helyes: "A" },
        { cim: "E", szoveg: "(A) 1 (B) 2", temakor: "egyenletek", nehezseg: 1 },
      ]),
      { topics },
    );
    expect(rows[0]!.row?.correct_choice).toBe("B");
    expect(rows[1]!.row?.correct_choice).toBe("A");
    expect(rows[2]!.errors.length).toBe(1);
    expect(rows[3]!.row?.correct_choice).toBeUndefined();
    expect(rows[3]!.warnings.length).toBe(1);
    expect(rows[4]!.warnings.some((w) => w.includes("Nincs helyes válasz"))).toBe(true);
  });
});

describe("CSV import", () => {
  it("idézőjel, sortörés a mezőben, pontosvessző", () => {
    const rows = parseCsv('a;b\n"x;1";"több\nsoros ""idézet"""\n');
    expect(rows).toEqual([
      { cells: ["a", "b"], line: 1 },
      { cells: ["x;1", 'több\nsoros "idézet"'], line: 2 },
    ]);
  });

  it("a minta CSV hibátlan, a kep_kell igen/nem értelmezett", () => {
    const text = readFileSync(new URL("../../public/mintak/feladatok-minta.csv", import.meta.url), "utf8");
    const rows = parseCsvImport(text, { topics });
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.errors.length === 0 && r.row?.requires_image === true)).toBe(true);
  });

  it("vesszővel elválasztva, CRLF sorvégekkel is", () => {
    const rows = parseCsvImport(
      "cim,szoveg,temakor,nehezseg,kep_kell\r\nA,$1+1$,egyenletek,1,nem\r\n",
      { topics },
    );
    expect(rows[0]!.row).toEqual({
      title: "A",
      body_md: "$1+1$",
      topic_slugs: ["egyenletek"],
      difficulty: 1,
      requires_image: false,
      task_type: "rovid",
    });
  });
});
