import { expect, test } from "bun:test";
import { normalizeCharacterName } from "./index";

test("preserves complete participant names instead of selecting title-cased fragments", () => {
  for (const name of [
    "Still in Love", "Still In Love", "Love in Bloom", "Ludwig van Beethoven", "The Pale",
    "New Jersey", "Old Man", "Sean O'Connor", "Jean-Luc Picard", "alice de la Cruz", "Élodie du Pré", "七海 千秋",
  ]) {
    expect(normalizeCharacterName(name)).toBe(name);
  }
});

test("removes explicit card decorations while preserving the complete name segment", () => {
  for (const [raw, name] of [
    ["★ Still in Love | Modern AU", "Still in Love"],
    ["[WIP] Still in Love", "Still in Love"],
    ["LIVE: Still in Love — A Chance Interrogation", "Still in Love"],
    ["NSFW / Ludwig van Beethoven / Episode 3", "Ludwig van Beethoven"],
    ["Mara | Dark Fantasy", "Mara"],
    ["Still in Love - Veil of Reason and Instinct", "Still in Love"],
    ["Jean-Luc Picard - Captain of the Enterprise", "Jean-Luc Picard"],
    ["  Élodie   du Pré  ", "Élodie du Pré"],
  ]) {
    expect(normalizeCharacterName(raw!)).toBe(name!);
  }
  // Decomposed accents are meaningful parts of a participant identity too.
  expect(normalizeCharacterName("Élodie du Pré".normalize("NFD"))).toBe("Élodie du Pré".normalize("NFD"));
});
