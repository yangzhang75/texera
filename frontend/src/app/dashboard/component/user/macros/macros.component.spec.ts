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

import { of } from "rxjs";
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
  let notif: any;
  let persist: any;
  let modal: any;
  let macroSvc: any;

  beforeEach(() => {
    runnable = true;
    navigate = vi.fn();
    macroSvc = { isMacroRunnable: () => runnable, listMacros: () => of([]) };
    notif = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    persist = {
      retrieveOwners: vi.fn(() => of(["a@b.c"])),
      deleteWorkflow: vi.fn(() => of({})),
      updateWorkflowDescription: vi.fn(() => of({})),
    };
    modal = { create: vi.fn(), confirm: vi.fn() };
    const metadataStub = { getOperatorMetadata: () => of({}) };
    // constructor: (macroService, notificationService, operatorMetadataService,
    //   workflowPersistService, modalService, router)
    component = new MacrosComponent(macroSvc, notif, metadataStub as any, persist, modal, { navigate } as any);
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

  it("metaLine renders the op chain + op count (markers dropped); edited/created live in their own column", () => {
    const line = component.metaLine(macro({ bodyOperatorTypes: ["CSVFileScan", "Filter", "MacroOutput"] }));
    expect(line).toBe("CSVFileScan → Filter · 2 ops"); // MacroOutput marker dropped
    expect(line).not.toContain("edited"); // times moved to the metadata column
  });

  it("metaLine reads 'Empty macro' when the body has only boundary markers", () => {
    expect(component.metaLine(macro({ bodyOperatorTypes: ["MacroInput", "MacroOutput"] }))).toBe("Empty macro");
  });

  it("defaults the filter to Runnable (biologist-facing page)", () => {
    expect(component.filterMode).toBe("runnable");
  });

  it("reload sorts macros newest-first (by lastModifiedTime, then wid)", () => {
    const list = [
      macro({ wid: 1, lastModifiedTime: "2026-01-01T00:00:00Z" }),
      macro({ wid: 2, lastModifiedTime: "2026-03-01T00:00:00Z" }),
      macro({ wid: 3, lastModifiedTime: "2026-02-01T00:00:00Z" }),
    ];
    macroSvc.listMacros = () => of(list);
    component.reload();
    expect(component.macros.map(m => m.wid)).toEqual([2, 3, 1]);
  });

  it("Share opens ShareAccessComponent for the macro (type=workflow, macro wid, owner write access)", async () => {
    await component.onShareMacro(macro({ wid: 7, isOwner: true } as Partial<MacroSummary>));
    expect(modal.create).toHaveBeenCalledTimes(1);
    const opts = modal.create.mock.calls[0][0];
    expect(opts.nzData).toMatchObject({ type: "workflow", id: 7, writeAccess: true });
  });

  it("Delete confirms, calls deleteWorkflow, and drops the row from the list", async () => {
    const m = macro({ wid: 9 });
    component.macros = [m, macro({ wid: 10 })];
    component.onDeleteMacro(m);
    const opts = modal.confirm.mock.calls[0][0];
    await opts.nzOnOk(); // run the confirm handler
    expect(persist.deleteWorkflow).toHaveBeenCalledWith([9]);
    expect(component.macros.map(x => x.wid)).toEqual([10]);
  });

  it("Change description persists via updateWorkflowDescription and updates the model", async () => {
    const m = macro({ wid: 11, description: "old" });
    component.onChangeDescription(m);
    const opts = modal.confirm.mock.calls[0][0];
    await opts.nzOnOk({ value: "new desc" }); // stub the inline editor component
    expect(persist.updateWorkflowDescription).toHaveBeenCalledWith(11, "new desc");
    expect(m.description).toBe("new desc");
  });
});
