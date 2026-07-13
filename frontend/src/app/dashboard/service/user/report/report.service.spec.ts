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
import { ReportService, WorkflowReportEntry } from "./report.service";

describe("ReportService", () => {
  let service: ReportService;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ReportService],
    });
    service = TestBed.inject(ReportService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
    vi.restoreAllMocks();
  });

  it("sends the correct POST body to report a workflow", () => {
    service.reportWorkflow(42, "Harassment", "bad content").subscribe();

    const req = httpTestingController.expectOne(r => r.url.endsWith("/report/42") && r.method === "POST");
    expect(req.request.body).toEqual({ reason: "Harassment", detail: "bad content" });
    req.flush(null);
  });

  it("issues a GET to the list endpoint and emits the reports", () => {
    let emitted: ReadonlyArray<WorkflowReportEntry> | undefined;
    service.listReports().subscribe(reports => (emitted = reports));

    const req = httpTestingController.expectOne(r => r.url.endsWith("/report/list") && r.method === "GET");
    const payload: WorkflowReportEntry[] = [
      {
        reportId: 1,
        wid: 42,
        workflowName: "wf",
        isPublic: true,
        reporterName: "alice",
        ownerUid: 9,
        ownerName: "bob",
        ownerPublishDisabled: false,
        reason: "Spam / advertising",
        detail: null,
        status: "PENDING",
        creationTime: 1234,
      },
    ];
    req.flush(payload);

    expect(emitted).toEqual(payload);
  });

  it("issues a PUT to the dismiss endpoint", () => {
    service.dismissReports(7).subscribe();

    const req = httpTestingController.expectOne(r => r.url.endsWith("/report/dismiss/7") && r.method === "PUT");
    expect(req.request.body).toEqual({});
    req.flush(null);
  });

  it("issues a PUT to the unpublish endpoint", () => {
    service.unpublishWorkflow(7).subscribe();

    const req = httpTestingController.expectOne(r => r.url.endsWith("/report/unpublish/7") && r.method === "PUT");
    expect(req.request.body).toEqual({});
    req.flush(null);
  });

  it("issues a PUT to the author-publishing endpoint with the disabled flag", () => {
    service.setAuthorPublishing(9, true).subscribe();

    const req = httpTestingController.expectOne(
      r => r.url.endsWith("/report/author/9/publishing") && r.method === "PUT"
    );
    expect(req.request.body).toEqual({ disabled: true });
    req.flush(null);
  });

  it("issues a GET to the moderated-workflows endpoint", () => {
    let emitted: ReadonlyArray<number> | undefined;
    service.getModeratedWorkflows().subscribe(wids => (emitted = wids));

    const req = httpTestingController.expectOne(r => r.url.endsWith("/report/moderated") && r.method === "GET");
    req.flush([1, 2, 3]);

    expect(emitted).toEqual([1, 2, 3]);
  });

  it("issues a GET to the moderation-notice endpoint for a workflow", () => {
    let emitted: unknown;
    service.getModerationNotice(9).subscribe(notice => (emitted = notice));

    const req = httpTestingController.expectOne(r => r.url.endsWith("/report/moderation/9") && r.method === "GET");
    const payload = { unpublished: true, reasons: ["Harassment", "Spam / advertising"], resolvedTime: 123 };
    req.flush(payload);

    expect(emitted).toEqual(payload);
  });
});
