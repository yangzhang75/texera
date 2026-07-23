/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { MacrosComponent } from "./macros.component";
import { MacroSummary } from "../../../../workspace/service/macro/macro.service";
import { USER_MACRO_OPEN, USER_WORKSPACE } from "../../../../app-routing.constant";

function macro(overrides: Partial<MacroSummary> = {}): MacroSummary {
  return {
    wid: 42,
    name: "m",
    description: "",
    creationTime: "2026-01-01T00:00:00Z",
    lastModifiedTime: "2026-01-01T00:00:00Z",
    portSpec: { inputs: [], outputs: [{ index: 0 }] },
    bodyOperatorTypes: ["CSVFileScan"],
    ...overrides,
  } as MacroSummary;
}

describe("MacrosComponent", () => {
  let runnable: boolean;
  let navigate: ReturnType<typeof vi.fn>;
  let component: MacrosComponent;

  beforeEach(() => {
    runnable = true;
    navigate = vi.fn();
    const macroServiceStub = { isMacroRunnable: () => runnable } as any;
    // constructor: (macroService, notificationService, operatorMetadataService, router)
    component = new MacrosComponent(macroServiceStub, {} as any, {} as any, { navigate } as any);
  });

  it("runnable macro opens the Generate (fill) page by default", () => {
    runnable = true;
    const m = macro();
    component.onOpen(m);
    expect(navigate).toHaveBeenCalledWith([USER_MACRO_OPEN, m.wid]);
  });

  it("not-runnable macro opens the Edit editor by default", () => {
    runnable = false;
    const m = macro({ portSpec: { inputs: [{ index: 0 }], outputs: [] } });
    component.onOpen(m);
    expect(navigate).toHaveBeenCalledWith([USER_WORKSPACE, m.wid, "macro", m.wid]);
  });

  it("explicit row actions always route the same way regardless of runnability", () => {
    const m = macro();
    component.onGenerate(m);
    expect(navigate).toHaveBeenCalledWith([USER_MACRO_OPEN, m.wid]);
    component.onEditMacro(m);
    expect(navigate).toHaveBeenCalledWith([USER_WORKSPACE, m.wid, "macro", m.wid]);
  });

  it("isRunnable delegates to the shared MacroService criterion", () => {
    runnable = false;
    expect(component.isRunnable(macro())).toBe(false);
    runnable = true;
    expect(component.isRunnable(macro())).toBe(true);
  });

  it("filteredMacros applies the name search and the Runnable filter", () => {
    component.macros = [macro({ wid: 1, name: "alpha" }), macro({ wid: 2, name: "beta" })];

    component.filterMode = "all";
    component.searchText = "";
    expect(component.filteredMacros.length).toBe(2);

    component.searchText = "alph";
    expect(component.filteredMacros.map(x => x.wid)).toEqual([1]);

    component.searchText = "";
    component.filterMode = "runnable";
    runnable = true;
    expect(component.filteredMacros.length).toBe(2);
    runnable = false;
    expect(component.filteredMacros.length).toBe(0);
  });

  it("metaLine folds the op chain, op count, and edited time into one line", () => {
    const line = component.metaLine(macro({ bodyOperatorTypes: ["CSVFileScan", "Filter", "MacroOutput"] }));
    expect(line).toContain("CSVFileScan → Filter"); // markers dropped
    expect(line).toContain("2 ops");
    expect(line).toContain("edited");
  });
});
