/**
 * Dio 2: mobilni katalog nije u produkciji — kad __DEV__ nije istinit, ekran pokazuje
 * samo poruku i ne renderuje katalog komponente.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

vi.mock("expo-router", async () => {
  const React = await import("react");
  const { View } = await import("react-native");
  return {
    Link: ({ children }: { children?: React.ReactNode }) => React.createElement(View, null, children),
    useRouter: () => ({ replace: () => undefined }),
  };
});

vi.mock("./ui/SignOutButton", () => ({ SignOutButton: () => null, logoutExplanation: () => "" }));

// Tijelo kataloga se u razvoju učitava dinamički (require) — u testu ga zamjenjuje marker.
vi.mock("./katalog-body", async () => {
  const React = await import("react");
  const { Text } = await import("react-native");
  return { default: () => React.createElement(Text, null, "Katalog komponenti") };
});

import KatalogScreen from "./app/katalog";

afterEach(() => cleanup());

describe("mobilni katalog (Dio 2)", () => {
  it("produkcija (__DEV__ = false): samo poruka, bez kataloga", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    render(<KatalogScreen />);
    expect(screen.getByText("Dostupno samo u razvojnoj gradnji.")).toBeTruthy();
    expect(screen.queryByText("Katalog komponenti")).toBeNull();
  });

  it("razvoj (__DEV__ = true): katalog se renderuje", async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    render(<KatalogScreen />);
    expect(await screen.findByText("Katalog komponenti")).toBeTruthy();
  });
});
