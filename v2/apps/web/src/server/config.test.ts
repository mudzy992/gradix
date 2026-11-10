import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, resetConfigForTests } from "./config";

const base: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://app:app@localhost:5432/gradix",
  AUTH_SECRET: "test-secret-with-at-least-32-characters",
};

afterEach(() => resetConfigForTests());

describe("login rate-limit konfiguracija (vrijednosti su u milisekundama)", () => {
  it("staging greška AUTH_LOGIN_WINDOW_MS=5 se odbija pri startu, jer bi prozor bio 0 sekundi", () => {
    resetConfigForTests();
    expect(() => loadConfig({ ...base, AUTH_LOGIN_WINDOW_MS: "5" })).toThrow(/AUTH_LOGIN_WINDOW_MS/);
  });

  it("odbija i previsok limit i predug prozor", () => {
    resetConfigForTests();
    expect(() => loadConfig({ ...base, AUTH_LOGIN_LIMIT: "500" })).toThrow(/AUTH_LOGIN_LIMIT/);
    resetConfigForTests();
    expect(() => loadConfig({ ...base, AUTH_LOGIN_WINDOW_MS: "86400000" })).toThrow(/AUTH_LOGIN_WINDOW_MS/);
  });

  it("prihvata podrazumijevano: 5 pokušaja u 60000 ms", () => {
    resetConfigForTests();
    const config = loadConfig({ ...base });
    expect(config.AUTH_LOGIN_LIMIT).toBe(5);
    expect(config.AUTH_LOGIN_WINDOW_MS).toBe(60_000);
  });
});
