/**
 * A11y provjera za ekrane. Jedno mjesto, isti prag za sve: pad na `serious` ili `critical`.
 *
 * Zašto ne „sve“: `moderate` u praksi hvata stvari koje su za ovaj proizvod odluka, ne greška
 * (npr. gusta tabela ima manje od 44 px meta — to je namjerno, gust dashboard). Prag je
 * zapisan ovdje, pa se mijenja na jednom mjestu i vidi u CI-ju.
 */
import { axe } from "vitest-axe";
import { expect } from "vitest";

export async function expectNoSeriousA11yViolations(container: Element): Promise<void> {
  const results = await axe(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  });
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  if (blocking.length > 0) {
    throw new Error(
      `A11y nalazi (${blocking.length}):\n` +
        blocking
          .map(
            (violation) =>
              `- [${violation.impact}] ${violation.id}: ${violation.help}\n  ${violation.nodes
                .slice(0, 3)
                .map((node) => node.target.join(" "))
                .join("\n  ")}`,
          )
          .join("\n"),
    );
  }
  expect(blocking).toHaveLength(0);
}
