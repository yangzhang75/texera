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
import { HUB_MACRO_RESULT_DETAIL, USER_MACRO_OPEN, USER_WORKSPACE } from "../../../../app-routing.constant";

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
    macroSvc = {
      isMacroRunnable: () => runnable,
      listMacros: () => of([]),
      listPublicMacros: () => of([]),
      cloneMacro: vi.fn(() => of(999)),
      exportMacroToFile: vi.fn(() => of(undefined)),
      importMacroFromJson: vi.fn(() => of({ wid: 42 })),
    };
    notif = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    persist = {
      retrieveOwners: vi.fn(() => of(["a@b.c"])),
      deleteWorkflow: vi.fn(() => of({})),
      updateWorkflowName: vi.fn(() => of({})),
      updateWorkflowDescription: vi.fn(() => of({})),
    };
    modal = { create: vi.fn(), confirm: vi.fn() };
    const metadataStub = { getOperatorMetadata: () => of({}) };
    // constructor: (macroService, notificationService, operatorMetadataService,
    //   workflowPersistService, modalService, router)
    const routeStub = { snapshot: { data: {} } };
    component = new MacrosComponent(
      macroSvc,
      notif,
      metadataStub as any,
      persist,
      modal,
      { navigate } as any,
      routeStub as any
    );
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

  it("defaults the filter to Runnable (biologist-facing page)", () => {
    expect(component.filterMode).toBe("runnable");
  });

  it("publicBrowse mode (Hub tab): fetches public macros, defaults filter to All, click always Generates", () => {
    const pub = vi.fn(() => of([macro({ wid: 3, isPublic: true } as Partial<MacroSummary>)]));
    macroSvc.listPublicMacros = pub;
    const listOwn = vi.fn(() => of([]));
    macroSvc.listMacros = listOwn;
    const routeStub = { snapshot: { data: { publicBrowse: true } } };
    const c = new MacrosComponent(macroSvc, notif, { getOperatorMetadata: () => of({}) } as any, persist, modal, {
      navigate,
    } as any, routeStub as any);
    c.ngOnInit();
    expect(c.publicBrowse).toBe(true);
    expect(c.filterMode).toBe("all");
    expect(pub).toHaveBeenCalled();
    expect(listOwn).not.toHaveBeenCalled();
    // someone else's public macro (not owner) → read-only preview/detail page
    runnable = false;
    c.onOpen(macro({ wid: 3, isOwner: false } as Partial<MacroSummary>));
    expect(navigate).toHaveBeenCalledWith([HUB_MACRO_RESULT_DETAIL, 3]);
    // your OWN public macro in the Hub, runnable → straight to Generate
    runnable = true;
    c.onOpen(macro({ wid: 4, isOwner: true } as Partial<MacroSummary>));
    expect(navigate).toHaveBeenCalledWith([USER_MACRO_OPEN, 4]);
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

  it("Delete removes the macro immediately (no confirm dialog) and drops the row", async () => {
    const m = macro({ wid: 9 });
    component.macros = [m, macro({ wid: 10 })];
    component.onDeleteMacro(m);
    expect(modal.confirm).not.toHaveBeenCalled(); // deletes directly, no popup
    expect(persist.deleteWorkflow).toHaveBeenCalledWith([9]);
    await new Promise(res => setTimeout(res, 0));
    expect(component.macros.map(x => x.wid)).toEqual([10]);
  });

  it("inline rename: confirmName persists via updateWorkflowName and updates the model", async () => {
    const m = macro({ wid: 11, name: "old" });
    component.startEditName(m);
    expect(component.editingNameWid).toBe(11);
    component.confirmName(m, "  new name  "); // trimmed
    expect(component.editingNameWid).toBeNull();
    expect(persist.updateWorkflowName).toHaveBeenCalledWith(11, "new name");
    await new Promise(res => setTimeout(res, 0));
    expect(m.name).toBe("new name");
  });

  it("inline rename: blank or unchanged name is a no-op (no API call)", () => {
    const m = macro({ wid: 12, name: "keep" });
    component.confirmName(m, "   ");
    component.confirmName(m, "keep");
    expect(persist.updateWorkflowName).not.toHaveBeenCalled();
    expect(m.name).toBe("keep");
  });

  it("inline description: confirmDesc persists via updateWorkflowDescription and updates the model", async () => {
    const m = macro({ wid: 13, description: "old" });
    component.startEditDesc(m);
    expect(component.editingDescWid).toBe(13);
    component.confirmDesc(m, "new desc");
    expect(component.editingDescWid).toBeNull();
    expect(persist.updateWorkflowDescription).toHaveBeenCalledWith(13, "new desc");
    await new Promise(res => setTimeout(res, 0));
    expect(m.description).toBe("new desc");
  });

  it("Hub clone: a runnable clone lands on the Runnable tab, a not-runnable clone on All", async () => {
    const cloneSpy = vi.fn(() => of(999));
    macroSvc.cloneMacro = cloneSpy;

    runnable = true;
    component.onCloneMacro(macro({ wid: 7, name: "shared" }));
    expect(cloneSpy).toHaveBeenCalledWith(7);
    await new Promise(res => setTimeout(res, 0));
    expect(navigate).toHaveBeenCalledWith([USER_MACRO_OPEN], { queryParams: { filter: "runnable" } });

    runnable = false;
    component.onCloneMacro(macro({ wid: 8, name: "shared2" }));
    await new Promise(res => setTimeout(res, 0));
    expect(navigate).toHaveBeenCalledWith([USER_MACRO_OPEN], { queryParams: { filter: "all" } });
  });

  it("onDownloadMacro exports the macro to a JSON file", () => {
    component.onDownloadMacro(macro({ wid: 5 }));
    expect(macroSvc.exportMacroToFile).toHaveBeenCalledWith(5);
  });

  it("onUploadMacro reads the file, imports it, resets the input, and reloads", async () => {
    const reloadSpy = vi.spyOn(component, "reload").mockImplementation(() => {});
    const file = new File(['{"name":"x"}'], "m.json", { type: "application/json" });
    const event = { target: { files: [file], value: "keep" } } as any;
    component.onUploadMacro(event);
    expect(event.target.value).toBe(""); // input reset so the same file can be re-picked
    await new Promise(res => setTimeout(res, 30)); // let FileReader.onload fire
    expect(macroSvc.importMacroFromJson).toHaveBeenCalledWith('{"name":"x"}');
    expect(reloadSpy).toHaveBeenCalled();
  });

  it("onUploadMacro is a no-op when no file is selected", () => {
    component.onUploadMacro({ target: { files: [] } } as any);
    expect(macroSvc.importMacroFromJson).not.toHaveBeenCalled();
  });

  it("reads ?filter from the query params on the owner Macros page", () => {
    const routeStub = { snapshot: { data: {}, queryParamMap: { get: () => "all" } } };
    const c = new MacrosComponent(macroSvc, notif, { getOperatorMetadata: () => of({}) } as any, persist, modal, {
      navigate,
    } as any, routeStub as any);
    c.ngOnInit();
    expect(c.filterMode).toBe("all");
  });

  it("onDescClick edits in place for owner, but lets the row open in public browse", () => {
    const m = macro({ wid: 14 });
    const ev = { stopPropagation: vi.fn() } as any;
    component.publicBrowse = false;
    component.onDescClick(m, ev);
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(component.editingDescWid).toBe(14);

    component.editingDescWid = null;
    const ev2 = { stopPropagation: vi.fn() } as any;
    component.publicBrowse = true;
    component.onDescClick(m, ev2);
    expect(ev2.stopPropagation).not.toHaveBeenCalled(); // click bubbles to row -> open
    expect(component.editingDescWid).toBeNull();
  });
});
