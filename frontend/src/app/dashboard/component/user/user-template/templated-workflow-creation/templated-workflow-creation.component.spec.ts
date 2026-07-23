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

import { of, EMPTY } from "rxjs";
import { TemplatedWorkflowCreationComponent } from "./templated-workflow-creation.component";

// The Generate page is now fill-only (the dual-mode toggle + whitelist editing
// moved to the Edit-macro view). These are smoke tests over what remains: the
// runnable gate and the macro-generate guard.
function make(): TemplatedWorkflowCreationComponent {
  const userService = { userChanged: () => of(null), isLogin: () => false, getCurrentUser: () => undefined } as any;
  const executeWorkflowService = {
    getExecutionState: () => ({ state: "Uninitialized" }),
    getExecutionStateStream: () => EMPTY,
  } as any;
  const macroService = { isMacroRunnable: () => true } as any;

  return new TemplatedWorkflowCreationComponent(
    { error: vi.fn(), success: vi.fn(), warning: vi.fn() } as any, // notificationService
    userService,
    {} as any, // workflowActionService
    {} as any, // templateService
    {} as any, // templatedWorkflowService
    {} as any, // templatedWorkflowDraftService
    executeWorkflowService,
    {} as any, // workflowPersistService
    {} as any, // operatorMetadataService
    {} as any, // dynamicSchemaService
    {} as any, // workflowCompilingService
    {} as any, // formlyJsonschema
    {} as any, // route
    {} as any, // http
    macroService,
    {} as any // router
  );
}

describe("TemplatedWorkflowCreationComponent (Generate, fill-only)", () => {
  it("defaults macroRunnable to true", () => {
    expect(make().macroRunnable).toBe(true);
  });

  it("generates even when the macro is NOT runnable (no runnable gate — yields an Invalid Workflow)", () => {
    const gen = vi.fn().mockReturnValue(EMPTY);
    const c = make();
    (c as any).macroService = { isMacroRunnable: () => false, generateWorkflowFromMacro: gen };
    c.macroId = 1;
    c.macroRunnable = false; // not runnable...
    (c as any).workflowReady = true;
    (c as any).buildMacroContentWithParams = () => ({
      operators: [],
      operatorPositions: {},
      links: [],
      commentBoxes: [],
      settings: {},
    });
    c.onCreateWorkflowFromMacro();
    expect(gen).toHaveBeenCalled(); // ...still proceeds: the gate is gone.
  });

  it("still guards on workflowReady (nothing generated before the preview is ready)", () => {
    const gen = vi.fn().mockReturnValue(EMPTY);
    const c = make();
    (c as any).macroService = { isMacroRunnable: () => true, generateWorkflowFromMacro: gen };
    c.macroId = 1;
    (c as any).workflowReady = false;
    c.onCreateWorkflowFromMacro();
    expect(gen).not.toHaveBeenCalled();
  });
});
