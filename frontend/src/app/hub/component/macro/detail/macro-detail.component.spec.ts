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
  let persist: any;
  let macroSvc: any;
  let notif: any;
  let c: MacroDetailComponent;

  beforeEach(() => {
    navigate = vi.fn(() => Promise.resolve(true));
    navigateByUrl = vi.fn(() => Promise.resolve(true));
    persist = {
      retrievePublicWorkflow: vi.fn(() =>
        of({
          name: "m",
          description: "d",
          content: {
            operators: [
              { operatorType: "MacroInput" },
              { operatorType: "Filter" },
              { operatorType: "Limit" },
              { operatorType: "MacroOutput" },
            ],
          },
        })
      ),
      getOwnerName: vi.fn(() => of("owner")),
    };
    macroSvc = { cloneMacro: vi.fn(() => of(999)) };
    notif = { success: vi.fn(), error: vi.fn() };
    const route = { snapshot: { params: { id: "7" } } };
    const router = { navigate, navigateByUrl };
    c = new MacroDetailComponent(persist, macroSvc, route as any, router as any, notif);
  });

  it("reads the wid from the route", () => {
    expect(c.wid).toBe(7);
  });

  it("ngOnInit loads the macro and builds the operator chain (markers become port counts)", () => {
    c.ngOnInit();
    expect(persist.retrievePublicWorkflow).toHaveBeenCalledWith(7);
    expect(c.macroName).toBe("m");
    expect(c.ownerName).toBe("owner");
    expect(c.operatorChain).toEqual(["Filter", "Limit"]); // markers dropped
    expect(c.inPorts).toBe(1);
    expect(c.outPorts).toBe(1);
  });

  it("onClone clones the macro and navigates to the user's Macros", async () => {
    c.onClone();
    expect(macroSvc.cloneMacro).toHaveBeenCalledWith(7);
    await new Promise(res => setTimeout(res, 0));
    expect(navigate).toHaveBeenCalledWith([USER_MACRO_OPEN]);
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
