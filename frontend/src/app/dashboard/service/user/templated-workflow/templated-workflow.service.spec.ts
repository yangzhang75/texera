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

import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";
import { AppSettings } from "../../../../common/app-setting";
import { TemplatedWorkflowService, TEMPLATED_WORKFLOW_BASE_URL } from "./templated-workflow.service";

describe("TemplatedWorkflowService", () => {
  let service: TemplatedWorkflowService;
  let httpTestingController: HttpTestingController;
  const base = `${AppSettings.getApiEndpoint()}/${TEMPLATED_WORKFLOW_BASE_URL}`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
    service = TestBed.inject(TemplatedWorkflowService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it("should be created", () => {
    expect(service).toBeTruthy();
  });

  it("createTemplatedWorkflow should POST to /build with the tid as a query param and return the wid", () => {
    let received: number | undefined;
    service.createTemplatedWorkflow(42).subscribe(wid => (received = wid));

    const req = httpTestingController.expectOne(`${base}/build?tid=42`);
    expect(req.request.method).toEqual("POST");
    req.flush(203);

    expect(received).toEqual(203);
  });

  it("updateTemplatedWorkflowProperties should POST the operatorProperties payload to /{wid}/update", () => {
    const payload = {
      operatorProperties: {
        "Limit-op-1": { limit: 88 },
      },
    };

    service.updateTemplatedWorkflowProperties(7, payload).subscribe();

    const req = httpTestingController.expectOne(`${base}/7/update`);
    expect(req.request.method).toEqual("POST");
    // The typed value must be sent through unchanged so it round-trips server-side.
    expect(req.request.body).toEqual(payload);
    req.flush({ wid: 7, name: "w", content: "{}" });
  });

  it("updateTemplatedWorkflowProperties should return the updated workflow from the response body", () => {
    const updated = { wid: 7, name: "updated", content: "{}" };
    let received: any;
    service
      .updateTemplatedWorkflowProperties(7, { operatorProperties: {} })
      .subscribe(w => (received = w));

    httpTestingController.expectOne(`${base}/7/update`).flush(updated);

    expect(received).toEqual(updated);
  });
});
