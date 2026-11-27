// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { TabPanel, Tabs } from "./overlays";

describe("TabPanel", () => {
  it("povezuje tabove i panele, podržava tastaturu i čuva stanje", async () => {
    const user = userEvent.setup();
    function Example() {
      const [tab, setTab] = useState("a");
      return <><Tabs id="test-tabs" label="Primjer" active={tab} onChange={setTab} tabs={[{ key:"a",label:"Prvi" },{ key:"b",label:"Drugi" }]} />
        <TabPanel groupId="test-tabs" tabKey="a" active={tab === "a"}><label>Unos<input /></label></TabPanel>
        <TabPanel groupId="test-tabs" tabKey="b" active={tab === "b"}>Drugi sadržaj</TabPanel></>;
    }
    const {container}=render(<Example />);
    expect(screen.getByRole("tabpanel",{name:"Prvi"})).toHaveAttribute("id","test-tabs-a-panel");
    await user.type(screen.getByRole("textbox",{name:"Unos"}),"Sačuvano");
    const first=screen.getByRole("tab",{name:"Prvi"});first.focus();await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab",{name:"Drugi"})).toHaveFocus();
    expect(screen.getByRole("tabpanel",{name:"Drugi"})).toBeVisible();
    await expectNoSeriousA11yViolations(container);
    await user.keyboard("{Home}");expect(screen.getByRole("textbox",{name:"Unos"})).toHaveValue("Sačuvano");
  });
});
