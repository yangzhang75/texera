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
import { FormControl, FormGroup } from "@angular/forms";
import { ExecutionState } from "../../../../../workspace/types/execute-workflow.interface";
import { TemplatedWorkflowCreationComponent } from "./templated-workflow-creation.component";

/**
 * The Submit button greys ("idle") once the exact configuration has been submitted, so the user is
 * not nudged into creating a pile of identical workflows; it reactivates the moment any parameter
 * or the name changes (that would create a genuinely different workflow).
 */
describe("TemplatedWorkflowCreationComponent submitIdle", () => {
  let component: TemplatedWorkflowCreationComponent;
  let metadataName: string;

  function makeSection(operatorID: string, value: Record<string, any>) {
    const form = new FormGroup<any>({});
    Object.entries(value).forEach(([k, v]) => form.addControl(k, new FormControl(v)));
    return { operatorID, label: operatorID, fields: [], form, model: { ...value } };
  }

  beforeEach(() => {
    metadataName = "My Flow";
    const userService: any = {
      userChanged: () => of(null),
      isLogin: () => true,
      getCurrentUser: () => ({ uid: 1 }),
    };
    const executeWorkflowService: any = {
      getExecutionState: () => ({ state: ExecutionState.Uninitialized }),
      getExecutionStateStream: () => of(),
    };
    const workflowActionService: any = { getWorkflowMetadata: () => ({ name: metadataName }) };

    component = new TemplatedWorkflowCreationComponent(
      {} as any, // notificationService
      userService,
      workflowActionService,
      {} as any, // templateService
      {} as any, // templatedWorkflowService
      {} as any, // templatedWorkflowDraftService
      executeWorkflowService,
      {} as any, // workflowPersistService
      {} as any, // operatorMetadataService
      {} as any, // dynamicSchemaService
      {} as any, // workflowCompilingService
      {} as any, // formlyJsonschema
      { snapshot: { params: {} } } as any, // route
      {} as any // http
    );

    (component as any).workflowReady = true;
    (component as any).sections = [makeSection("op1", { fileName: "a.csv" })];
  });

  it("stays active (not grey) before the first submit", () => {
    expect(component.submitIdle).toBe(false);
  });

  it("goes grey right after a successful submit", () => {
    (component as any).lastSubmitted = (component as any).currentSubmission();
    expect(component.submitIdle).toBe(true);
  });

  it("reactivates when a parameter value changes after submitting", () => {
    (component as any).lastSubmitted = (component as any).currentSubmission();
    expect(component.submitIdle).toBe(true);

    (component as any).sections[0].form.get("fileName").setValue("b.csv");
    expect(component.submitIdle).toBe(false);
  });

  it("reactivates when only the workflow name changes after submitting", () => {
    (component as any).lastSubmitted = (component as any).currentSubmission();
    expect(component.submitIdle).toBe(true);

    metadataName = "A Different Name";
    expect(component.submitIdle).toBe(false);
  });

  it("is never grey while the preview is still loading or running", () => {
    (component as any).lastSubmitted = (component as any).currentSubmission();
    expect(component.submitIdle).toBe(true);

    (component as any).workflowReady = false; // still loading -> hard disabled, so not "idle"
    expect(component.submitIdle).toBe(false);
  });
});
