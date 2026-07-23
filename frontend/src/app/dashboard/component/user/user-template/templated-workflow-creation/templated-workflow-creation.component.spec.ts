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

let updateWhitelistSpy: ReturnType<typeof vi.fn>;

function make(): TemplatedWorkflowCreationComponent {
  updateWhitelistSpy = vi.fn().mockReturnValue(of(undefined));
  const notificationService = { error: vi.fn(), success: vi.fn(), warning: vi.fn() } as any;
  const userService = { userChanged: () => of(null), isLogin: () => false, getCurrentUser: () => undefined } as any;
  const executeWorkflowService = {
    getExecutionState: () => ({ state: "Uninitialized" }),
    getExecutionStateStream: () => EMPTY,
  } as any;
  const workflowPersistService = {
    updateWorkflowName: vi.fn().mockReturnValue(of(undefined)),
    updateWorkflowDescription: vi.fn().mockReturnValue(of(undefined)),
  } as any;
  const operatorMetadataService = {
    getOperatorSchema: () => ({ jsonSchema: { properties: {} }, additionalMetadata: { inputPorts: [] } }),
  } as any;
  const dynamicSchemaService = {
    dynamicSchemaExists: () => false,
    getOperatorDynamicSchemaChangedStream: () => EMPTY,
  } as any;
  const formlyJsonschema = { toFieldConfig: () => ({ fieldGroup: [] }) } as any;
  const macroService = {
    isMacroRunnable: () => true,
    updateMacroConfigurableProperties: updateWhitelistSpy,
    configurableCandidates: () => [],
  } as any;
  const templatedWorkflowDraftService = {
    hasDraftDynamicSchema: () => false,
    getDraftDynamicSchema: () => undefined,
    getOperatorProperties: () => ({}),
    initialize: () => undefined,
  } as any;

  return new TemplatedWorkflowCreationComponent(
    notificationService,
    userService,
    {} as any, // workflowActionService
    {} as any, // templateService
    {} as any, // templatedWorkflowService
    templatedWorkflowDraftService,
    executeWorkflowService,
    workflowPersistService,
    operatorMetadataService,
    dynamicSchemaService,
    {} as any, // workflowCompilingService
    formlyJsonschema,
    {} as any, // route
    {} as any, // http
    macroService,
    {} as any // router
  );
}

function fakeTemplate() {
  return {
    operators: [
      { operatorID: "op1", operatorType: "Filter", operatorProperties: {}, configurableProperties: [] },
    ],
    operatorPositions: {},
    links: [],
    commentBoxes: [],
    settings: {},
  } as any;
}

describe("TemplatedWorkflowCreationComponent dual mode", () => {
  it("defaults to Macro mode", () => {
    expect(make().pageMode).toBe("macro");
  });

  it("allows switching to Template mode when the macro is runnable", () => {
    const c = make();
    c.macroId = 1;
    c.macroRunnable = true;
    c.switchMode("template");
    expect(c.pageMode).toBe("template");
  });

  it("blocks switching to Template mode when the macro is NOT runnable (toggle gate)", () => {
    const c = make();
    c.macroId = 1;
    c.macroRunnable = false;
    c.switchMode("template");
    expect(c.pageMode).toBe("macro");
    expect(c.canUseTemplateMode()).toBe(false);
  });

  it("can always switch back to Macro mode", () => {
    const c = make();
    c.macroId = 1;
    c.macroRunnable = true;
    c.switchMode("template");
    c.switchMode("macro");
    expect(c.pageMode).toBe("macro");
  });
});

describe("TemplatedWorkflowCreationComponent whitelist", () => {
  it("checking a property adds it to the whitelist, applies it to the template op, and persists", () => {
    const c = make();
    c.macroId = 1;
    c.template = fakeTemplate();
    c.whitelist = {};

    c.toggleWhitelist("op1", "condition");

    expect(c.whitelist["op1"]).toEqual(["condition"]);
    expect(c.template!.operators[0].configurableProperties).toEqual(["condition"]);
    expect(updateWhitelistSpy).toHaveBeenCalledWith(1, { op1: ["condition"] });
  });

  it("unchecking the last property removes the operator from the whitelist", () => {
    const c = make();
    c.macroId = 1;
    c.template = fakeTemplate();
    c.whitelist = { op1: ["condition"] };

    c.toggleWhitelist("op1", "condition");

    expect(c.whitelist["op1"]).toBeUndefined();
    expect(c.template!.operators[0].configurableProperties).toEqual([]);
  });

  it("isWhitelisted reflects the current selection", () => {
    const c = make();
    c.whitelist = { op1: ["condition"] };
    expect(c.isWhitelisted("op1", "condition")).toBe(true);
    expect(c.isWhitelisted("op1", "other")).toBe(false);
  });
});
