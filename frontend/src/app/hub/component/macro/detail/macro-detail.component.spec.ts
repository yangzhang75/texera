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
import { MacroDetailComponent } from "./macro-detail.component";
import { HUB_MACRO_RESULT, USER_MACRO_OPEN } from "../../../../app-routing.constant";

describe("MacroDetailComponent", () => {
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let wfAction: any;
  let metadata: any;
  let persist: any;
  let macroSvc: any;
  let notif: any;
  let positionedWorkflow: any;
  let c: MacroDetailComponent;

  beforeEach(() => {
    navigate = vi.fn(() => Promise.resolve(true));
    navigateByUrl = vi.fn(() => Promise.resolve(true));
    wfAction = {
      disableWorkflowModification: vi.fn(),
      reloadWorkflow: vi.fn(),
      getTexeraGraph: () => ({ triggerCenterEvent: vi.fn() }),
      clearWorkflow: vi.fn(),
    };
    metadata = { getOperatorMetadata: () => of({}) };
    persist = { getOwnerName: vi.fn(() => of("owner")) };
    positionedWorkflow = { content: { operators: [], operatorPositions: {} } };
    macroSvc = {
      getMacro: vi.fn(() => of({ wid: 7, name: "m", description: "d" })),
      macroDetailToWorkflow: vi.fn(() => positionedWorkflow),
      isMacroRunnable: vi.fn(() => false),
      cloneMacro: vi.fn(() => of(999)),
    };
    notif = { success: vi.fn(), error: vi.fn() };
    const route = { snapshot: { params: { id: "7" } } };
    const router = { navigate, navigateByUrl };
    c = new MacroDetailComponent(wfAction, metadata, persist, macroSvc, route as any, router as any, notif);
  });

  it("reads the wid from the route and makes the preview read-only", () => {
    expect(c.wid).toBe(7);
    expect(wfAction.disableWorkflowModification).toHaveBeenCalled();
  });

  it("ngAfterViewInit loads the macro via getMacro + macroDetailToWorkflow (positioned) and reloads the canvas", () => {
    c.ngAfterViewInit();
    expect(macroSvc.getMacro).toHaveBeenCalledWith(7);
    expect(macroSvc.macroDetailToWorkflow).toHaveBeenCalled();
    expect(wfAction.reloadWorkflow).toHaveBeenCalledWith(positionedWorkflow);
    expect(c.macroName).toBe("m");
  });

  it("onClone clones the macro and navigates to the Macros tab on a filter that shows it", async () => {
    c.onClone(); // not-runnable by default -> All tab
    expect(macroSvc.cloneMacro).toHaveBeenCalledWith(7);
    await new Promise(res => setTimeout(res, 0));
    expect(navigate).toHaveBeenCalledWith([USER_MACRO_OPEN], { queryParams: { filter: "all" } });
  });

  it("onGenerate opens the Generate page for this macro", () => {
    c.onGenerate();
    expect(navigate).toHaveBeenCalledWith([USER_MACRO_OPEN, 7]);
  });

  it("goBack returns to the public macro catalogue", () => {
    c.goBack();
    expect(navigateByUrl).toHaveBeenCalledWith(HUB_MACRO_RESULT);
  });
});
