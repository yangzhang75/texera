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
import { of, Subject } from "rxjs";
import { FormGroup } from "@angular/forms";
import { TemplatedWorkflowCreationComponent } from "./templated-workflow-creation.component";
import { ExecutionState } from "../../../../../workspace/types/execute-workflow.interface";

/**
 * Exercises the real submit code path of the component (not the backend, not the rendered form):
 * a single configurable field is changed and submitted repeatedly, and we capture the exact
 * payload sent to the templated-workflow update endpoint to confirm every submit carries the
 * latest value -- including the "change only a Filter condition symbol" and "change only Limit"
 * cases the user cares about. Also verifies the "no changes" short-circuit.
 */
describe("TemplatedWorkflowCreationComponent submit", () => {
  let component: TemplatedWorkflowCreationComponent;
  let updateSpy: ReturnType<typeof vi.fn>;
  let createSpy: ReturnType<typeof vi.fn>;
  let notify: { warning: any; error: any; info: any; success: any };

  // current form models (mutated to simulate single-field edits, like the user typing)
  let filterModel: { predicates: { attribute: string; condition: string; value: string }[] };
  let limitModel: { limit: number };

  const lastPayload = () => updateSpy.mock.calls.at(-1)![1] as { operatorProperties: Record<string, any> };

  beforeEach(() => {
    updateSpy = vi.fn(() => of({ wid: 99 }));
    createSpy = vi.fn(() => of(99));
    notify = { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() };

    const userService: any = {
      userChanged: () => new Subject(),
      getCurrentUser: () => ({ uid: 1 }),
      isLogin: () => true,
    };
    const executeWorkflowService: any = {
      getExecutionState: () => ({ state: ExecutionState.Uninitialized }),
      getExecutionStateStream: () => new Subject(),
    };
    const templatedWorkflowService: any = {
      createTemplatedWorkflow: createSpy,
      updateTemplatedWorkflowProperties: updateSpy,
    };
    const changeDetectorRef: any = { detectChanges: vi.fn() };
    const noop: any = {};

    component = new TemplatedWorkflowCreationComponent(
      notify as any, // notificationService
      userService, // userService
      noop, // workflowActionService
      noop, // templateService
      noop, // templatedWorkflowDraftService
      templatedWorkflowService, // templatedWorkflowService
      executeWorkflowService, // executeWorkflowService
      noop, // operatorMetadataService
      noop, // dynamicSchemaService
      noop, // workflowCompilingService
      noop, // formlyJsonschema
      { snapshot: { params: {} } } as any, // route
      noop, // http
      changeDetectorRef // changeDetectorRef
    );

    filterModel = { predicates: [{ attribute: "A", condition: "<", value: "1.5" }] };
    limitModel = { limit: 5 };
    // empty FormGroup is valid, and the payload is built from `model`, so this is enough.
    (component as any).sections = [
      { operatorID: "Filter", label: "Filter", fields: [], form: new FormGroup({}), model: filterModel },
      { operatorID: "Limit", label: "Limit", fields: [], form: new FormGroup({}), model: limitModel },
    ];
    component.tid = 1;
  });

  it("first submit creates the workflow and sends all configurable values", () => {
    component.onJobFormSubmitted();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(component.wid).toBe(99);
    expect(lastPayload().operatorProperties["Limit"].limit).toBe(5);
    expect(lastPayload().operatorProperties["Filter"].predicates[0].condition).toBe("<");
    expect(component.submitButtonText).toBe("Update"); // becomes Update after first submit
  });

  it("changing ONLY the Filter condition symbol applies on every submit (1..4)", () => {
    component.onJobFormSubmitted(); // create
    const symbols = [">", "!=", "=", "<="];
    symbols.forEach((sym, i) => {
      filterModel.predicates[0].condition = sym; // single-field edit
      const before = updateSpy.mock.calls.length;
      component.onJobFormSubmitted();
      expect(updateSpy.mock.calls.length, `submit #${i + 1} should send an update`).toBe(before + 1);
      expect(lastPayload().operatorProperties["Filter"].predicates[0].condition).toBe(sym);
      // unrelated field stays intact
      expect(lastPayload().operatorProperties["Limit"].limit).toBe(5);
    });
  });

  it("changing ONLY the Limit applies on every submit (1..4)", () => {
    component.onJobFormSubmitted(); // create
    [10, 20, 33, 7].forEach((v, i) => {
      limitModel.limit = v;
      const before = updateSpy.mock.calls.length;
      component.onJobFormSubmitted();
      expect(updateSpy.mock.calls.length, `submit #${i + 1} should send an update`).toBe(before + 1);
      expect(lastPayload().operatorProperties["Limit"].limit).toBe(v);
      expect(lastPayload().operatorProperties["Filter"].predicates[0].condition).toBe("<");
    });
  });

  it("submitting with no change does NOT call update and reports 'No changes'", () => {
    component.onJobFormSubmitted(); // create (applies values)
    const callsAfterCreate = updateSpy.mock.calls.length;
    component.onJobFormSubmitted(); // nothing changed
    expect(updateSpy.mock.calls.length).toBe(callsAfterCreate); // no extra update
    expect(notify.info).toHaveBeenCalledWith("No changes to apply.");
  });

  it("a no-op submit followed by a real change still applies the change", () => {
    component.onJobFormSubmitted(); // create
    component.onJobFormSubmitted(); // no-op
    limitModel.limit = 88;
    component.onJobFormSubmitted(); // real change
    expect(lastPayload().operatorProperties["Limit"].limit).toBe(88);
  });
});
