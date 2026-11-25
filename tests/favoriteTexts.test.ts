import { expect, test } from "vitest";
import { favoritesNotFoundText } from "../src/store/favoriteTexts";

test("favoritesNotFoundText: singular and plural", () => {
  expect(favoritesNotFoundText(1)).toBe("1 Favorit nicht gefunden");
  expect(favoritesNotFoundText(3)).toBe("3 Favoriten nicht gefunden");
});
