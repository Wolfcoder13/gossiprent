import { describe, expect, it } from "vitest";
import { HOME_POSTCODES, isHomePostcode, placeName, postcodesMatching } from "@/lib/postcodes";
import {
  foldForSearch,
  icelandicSortKey,
  normalizeText,
  normalizeUnit,
  personNameKeys,
  propertyAddressKeys,
} from "@/lib/text";

describe("normalizeText", () => {
  it("composes accents (NFC), trims and collapses whitespace", () => {
    expect(normalizeText("  Jón \t  Jónsson\n")).toBe("Jón Jónsson");
    expect(normalizeText("Jón")).toHaveLength(3);
    expect(normalizeText("   ")).toBe("");
  });
});

describe("foldForSearch", () => {
  it.each([
    ["Þórdís", "thordis"],
    ["ÆGISSÍÐA", "aegissida"],
    ["Kópavogur", "kopavogur"],
    ["  Hafnarfjörður ", "hafnarfjordur"],
    ["Ýmir Úlfur Éljagangur", "ymir ulfur eljagangur"],
    ["Søren Müller", "soren muller"],
    ["thordis", "thordis"],
  ])("%j → %j", (input, expected) => {
    expect(foldForSearch(input)).toBe(expected);
  });

  it("is idempotent, so folded queries can be folded again safely", () => {
    for (const value of ["Þórdís", "Dæmi leigufélag ehf.", "Njálsgata 23 0201"]) {
      expect(foldForSearch(foldForSearch(value))).toBe(foldForSearch(value));
    }
  });
});

describe("icelandicSortKey", () => {
  const sorted = (values: string[]) =>
    [...values].sort((a, b) => (icelandicSortKey(a) < icelandicSortKey(b) ? -1 : 1));

  it("sorts names A–Ö, accented letters after their plain ones", () => {
    const names = [
      "Örn",
      "Ægir",
      "Þórdís",
      "Zoe",
      "Ýr",
      "Yrsa",
      "Úlfur",
      "Unnur",
      "Óttar",
      "Ólafur",
      "Oddur",
      "Íris",
      "Ingi",
      "Eva",
      "Davíð",
      "Bjarni",
      "Ásta",
      "Anna",
    ];
    expect(sorted(names)).toEqual([...names].reverse());
  });

  it("ignores case, and treats a hyphen like a space", () => {
    expect(icelandicSortKey("anna lísa")).toBe(icelandicSortKey("Anna Lísa"));
    expect(icelandicSortKey("Anna-Lísa")).toBe(icelandicSortKey("Anna Lísa"));
    expect(sorted(["Annabella", "Anna Lísa", "Anna"])).toEqual(["Anna", "Anna Lísa", "Annabella"]);
  });

  it("sorts house numbers by value", () => {
    expect(sorted(["Hringbraut 101", "Hringbraut 79", "Hringbraut 9", "Hringbraut 9a", "Hringbraut"])).toEqual([
      "Hringbraut",
      "Hringbraut 9",
      "Hringbraut 9a",
      "Hringbraut 79",
      "Hringbraut 101",
    ]);
  });

  it("puts foreign letters with their Icelandic look-alikes, and other characters last", () => {
    expect(sorted(["Ørsted", "Olsen", "Pétur"])).toEqual(["Olsen", "Pétur", "Ørsted"]);
    expect(icelandicSortKey("Müller")).toBe(icelandicSortKey("Muller"));
    expect(sorted(["Mörður", "Müller", "Mýrdal"])).toEqual(["Müller", "Mýrdal", "Mörður"]);
    expect(sorted(["東京", "Örn"])).toEqual(["Örn", "東京"]);
  });

  it("uses only digits and capital letters, so any database collation orders keys the same", () => {
    for (const value of ["O'Brien & Co.", "Dæmi leigufélag ehf.", "東京 😀", "Njálsgata 23, íb. 0201", "Anna-Lísa"]) {
      expect(icelandicSortKey(value), value).toMatch(/^[0-9A-Z]*$/);
    }
  });
});

describe("normalizeUnit", () => {
  it.each([
    ["íbúð 0201", "0201"],
    ["Íbúð 0201", "0201"],
    ["ÍBÚÐ 0201", "0201"],
    ["íb. 0201", "0201"],
    ["íb.0201", "0201"],
    ["apt 3", "3"],
    ["Apt. 3B", "3B"],
    ["unit 2B", "2B"],
    ["#4", "4"],
    ["# 4", "4"],
    ["  0201  ", "0201"],
    ["2. hæð t.v.", "2. hæð t.v."],
    ["Unitas 1", "Unitas 1"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected);
  });

  it.each([[""], ["   "], ["íbúð"], ["#"], [null], [undefined]])("%j → null", (input) => {
    expect(normalizeUnit(input)).toBeNull();
  });
});

describe("personNameKeys", () => {
  it("normalizes the name and derives its sort and search keys from it", () => {
    expect(personNameKeys("  Þórdís   Eva ")).toEqual({
      name: "Þórdís Eva",
      nameSort: icelandicSortKey("Þórdís Eva"),
      nameSearch: "thordis eva",
    });
  });
});

describe("propertyAddressKeys", () => {
  it("normalizes the address and apartment and derives the keys from both", () => {
    expect(propertyAddressKeys("  Njálsgata   23 ", "íbúð 0201")).toEqual({
      address: "Njálsgata 23",
      unit: "0201",
      addressSort: icelandicSortKey("Njálsgata 23 0201"),
      addressSearch: "njalsgata 23 0201",
    });
    expect(propertyAddressKeys("Hringbraut 79", "")).toEqual({
      address: "Hringbraut 79",
      unit: null,
      addressSort: icelandicSortKey("Hringbraut 79"),
      addressSearch: "hringbraut 79",
    });
  });

  it("gives the same search key however the same apartment is typed (the uniqueness key)", () => {
    const key = propertyAddressKeys("Njálsgata 23", "0201").addressSearch;
    for (const [address, unit] of [
      ["NJÁLSGATA 23", "Íb. 0201"],
      ["njalsgata 23", "apt 0201"],
      ["Njálsgata  23", "#0201"],
    ]) {
      expect(propertyAddressKeys(address, unit).addressSearch, `${address} / ${unit}`).toBe(key);
    }
    expect(propertyAddressKeys("Njálsgata 23", "0202").addressSearch).not.toBe(key);
  });
});

describe("postcodes", () => {
  it("lists home postcodes once each, in numeric order, without PO-box-only codes", () => {
    const codes = HOME_POSTCODES.map((p) => p.code);
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
    expect(new Set(codes).size).toBe(codes.length);
    expect(HOME_POSTCODES).toContainEqual({ code: 101, place: "Reykjavík" });
    expect(HOME_POSTCODES).toContainEqual({ code: 200, place: "Kópavogur" });
    expect(HOME_POSTCODES).toContainEqual({ code: 600, place: "Akureyri" });
    for (const { code } of HOME_POSTCODES) expect(code >= 100 && code <= 999, String(code)).toBe(true);
  });

  it("knows which codes are home postcodes and their places", () => {
    expect(isHomePostcode(101)).toBe(true);
    expect(isHomePostcode(99)).toBe(false);
    expect(isHomePostcode(1000)).toBe(false);
    expect(placeName(230)).toBe("Reykjanesbær");
    expect(placeName(800)).toBe("Selfoss");
    expect(placeName(1)).toBe("1");
  });

  it("matches a search word to postcodes by code or place name, ignoring accents and case", () => {
    expect(postcodesMatching("101")).toEqual([101]);
    expect(postcodesMatching(" 600 ")).toEqual([600]);
    expect(postcodesMatching("kopavogur")).toEqual(expect.arrayContaining([200, 201, 203]));
    expect(postcodesMatching("KÓPAVOGUR")).toEqual(postcodesMatching("kopavogur"));
    expect(postcodesMatching("hafnarfjordur")).toEqual(expect.arrayContaining([220, 221]));
    for (const code of postcodesMatching("reykjavik")) expect(placeName(code)).toBe("Reykjavík");
  });

  it("matches nothing for unknown codes and words too short to mean a place", () => {
    expect(postcodesMatching("099")).toEqual([]);
    expect(postcodesMatching("1000")).toEqual([]);
    expect(postcodesMatching("rv")).toEqual([]);
    expect(postcodesMatching("")).toEqual([]);
    expect(postcodesMatching("zzzz")).toEqual([]);
  });
});
