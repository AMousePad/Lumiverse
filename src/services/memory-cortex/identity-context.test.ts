import { expect, test } from "bun:test";
import { buildCortexIdentityContext } from "./identity-context";

test("one vocabulary resolves display labels and aliases for all entity categories", () => {
  const names = ["Still in Love", "New Eridu", "Dawnbreaker", "Azure Guard", "Black Tide Incident", "Silver Oath"];
  const known = names.map((name, index) => ({ name, aliases: [`Reference${index}`] }));
  const card = "Still in Love - Veil of Reason and Instinct";
  const context = buildCortexIdentityContext([names[0]!], known, new Map([["Still", names[0]!]]), [
    { name: names[0]!, role: "character", aliases: [card] },
  ]);
  names.forEach((name, index) => expect(context.canonicalize(`Reference${index}`)).toBe(name));
  expect(context.canonicalize(card)).toBe(names[0]!);
  expect(context.canonicalize("STILL")).toBe(names[0]!);
  expect(context.canonicalize("Unrelated")).toBe("Unrelated");
});

test("ambiguous aliases and aliases matching a different canonical do not redirect identity", () => {
  const context = buildCortexIdentityContext(["Mara", "Red", "Tovin"], [
    { name: "Mara", aliases: ["Red", "Captain"] }, { name: "Tovin", aliases: ["Captain"] },
  ]);
  expect(context.canonicalize("Red")).toBe("Red");
  expect(context.canonicalize("Captain")).toBe("Captain");
  expect(context.aliases.size).toBe(0);
});
