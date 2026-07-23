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
import { USER_WORKSPACE } from "../../../../app-routing.constant";

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

describe("MacrosComponent row open (Phase 2 C4: gate relocated to the page toggle)", () => {
  let runnable: boolean;
  let navigate: ReturnType<typeof vi.fn>;
  let component: MacrosComponent;

  beforeEach(() => {
    runnable = true;
    navigate = vi.fn();
    const macroServiceStub = {
      isMacroRunnable: () => runnable,
    } as any;
    const routerStub = { navigate } as any;
    component = new MacrosComponent(macroServiceStub, {} as any, {} as any, {} as any, routerStub);
  });

  it("opens the editable macro editor (drill-down route) for a runnable macro", () => {
    runnable = true;
    const m = macro();
    component.onOpen(m);
    expect(navigate).toHaveBeenCalledWith([USER_WORKSPACE, m.wid, "macro", m.wid]);
  });

  it("STILL opens the editor for a not-runnable macro (editing is always allowed)", () => {
    runnable = false;
    const m = macro({ portSpec: { inputs: [{ index: 0 }], outputs: [] } });
    component.onOpen(m);
    expect(navigate).toHaveBeenCalledWith([USER_WORKSPACE, m.wid, "macro", m.wid]);
  });

  it("does not navigate while an inline name edit is in progress on the row", () => {
    runnable = true;
    const m = macro();
    component.editingNameWid = m.wid;
    component.onOpen(m);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("isRunnable delegates to the shared MacroService criterion (informational label)", () => {
    runnable = false;
    expect(component.isRunnable(macro())).toBe(false);
    runnable = true;
    expect(component.isRunnable(macro())).toBe(true);
  });
});
