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

import { ComponentFixture, TestBed } from "@angular/core/testing";
import { HttpClientTestingModule } from "@angular/common/http/testing";
import { of, throwError } from "rxjs";
import { NzMessageService } from "ng-zorro-antd/message";
import { AdminReportComponent } from "./admin-report.component";
import { ReportService, WorkflowReportEntry } from "../../../service/user/report/report.service";
import { commonTestProviders } from "../../../../common/testing/test-utils";

function entry(overrides: Partial<WorkflowReportEntry>): WorkflowReportEntry {
  return {
    reportId: 1,
    wid: 100,
    workflowName: "wf",
    isPublic: true,
    reporterName: "alice",
    ownerUid: 500,
    ownerName: "owner",
    ownerPublishDisabled: false,
    reason: "Harassment",
    detail: null,
    status: "PENDING",
    creationTime: 1000,
    ...overrides,
  };
}

describe("AdminReportComponent", () => {
  let component: AdminReportComponent;
  let fixture: ComponentFixture<AdminReportComponent>;
  let reportServiceStub: {
    listReports: ReturnType<typeof vi.fn>;
    dismissReports: ReturnType<typeof vi.fn>;
    unpublishWorkflow: ReturnType<typeof vi.fn>;
    setAuthorPublishing: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    reportServiceStub = {
      listReports: vi.fn().mockReturnValue(of([])),
      dismissReports: vi.fn().mockReturnValue(of(void 0)),
      unpublishWorkflow: vi.fn().mockReturnValue(of(void 0)),
      setAuthorPublishing: vi.fn().mockReturnValue(of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [AdminReportComponent, HttpClientTestingModule],
      providers: [
        { provide: ReportService, useValue: reportServiceStub },
        { provide: NzMessageService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } },
        ...commonTestProviders,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminReportComponent);
    component = fixture.componentInstance;
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("groups reports by workflow with counts, reason breakdown, deduped reporters and non-blank details", () => {
    reportServiceStub.listReports.mockReturnValue(
      of([
        entry({ wid: 100, reporterName: "alice", reason: "Harassment", detail: "detail A", creationTime: 1000 }),
        entry({ wid: 100, reporterName: "bob", reason: "Spam / advertising", detail: null, creationTime: 3000 }),
        entry({ wid: 100, reporterName: "carol", reason: "Harassment", detail: "   ", creationTime: 2000 }),
        entry({ wid: 200, reporterName: "dave", reason: "Other", detail: "x", creationTime: 5000 }),
      ] as WorkflowReportEntry[])
    );

    component.loadReports();

    expect(component.groups.length).toBe(2);

    // Most-reported workflow comes first.
    const first = component.groups[0];
    expect(first.wid).toBe(100);
    expect(first.reportCount).toBe(3);
    expect(first.reasons).toBe("Harassment (2), Spam / advertising");
    expect(first.reporters).toBe("alice, bob, carol");
    // null and whitespace-only details are dropped; only the real one remains.
    expect(first.details).toEqual(["detail A"]);

    const second = component.groups[1];
    expect(second.wid).toBe(200);
    expect(second.reportCount).toBe(1);
    expect(second.details).toEqual(["x"]);
  });

  it("shows no groups when there are no reports", () => {
    reportServiceStub.listReports.mockReturnValue(of([]));
    component.loadReports();
    expect(component.groups).toEqual([]);
  });

  it("dismiss calls the service and reloads the list", () => {
    reportServiceStub.listReports.mockReturnValue(of([entry({ wid: 100 })]));
    component.loadReports();
    reportServiceStub.listReports.mockClear();

    component.dismiss(component.groups[0]);

    expect(reportServiceStub.dismissReports).toHaveBeenCalledWith(100);
    expect(reportServiceStub.listReports).toHaveBeenCalledTimes(1); // reloaded after dismiss
  });

  it("unpublish calls the service and reloads the list", () => {
    reportServiceStub.listReports.mockReturnValue(of([entry({ wid: 100 })]));
    component.loadReports();
    reportServiceStub.listReports.mockClear();

    component.unpublish(component.groups[0]);

    expect(reportServiceStub.unpublishWorkflow).toHaveBeenCalledWith(100);
    expect(reportServiceStub.listReports).toHaveBeenCalledTimes(1); // reloaded after unpublish
  });

  it("restrict/allow author calls the service with the owner uid and reloads", () => {
    reportServiceStub.listReports.mockReturnValue(of([entry({ wid: 100, ownerUid: 777 })]));
    component.loadReports();
    reportServiceStub.listReports.mockClear();

    component.setAuthorPublishing(component.groups[0], true);

    expect(reportServiceStub.setAuthorPublishing).toHaveBeenCalledWith(777, true);
    expect(reportServiceStub.listReports).toHaveBeenCalledTimes(1); // reloaded afterwards
  });

  it("builds a read-only preview link and joins details for the tooltip", () => {
    expect(component.detailLink(42)).toBe("/hub/workflow/result/detail/42");
    reportServiceStub.listReports.mockReturnValue(
      of([entry({ wid: 100, detail: "a" }), entry({ wid: 100, detail: "b" })])
    );
    component.loadReports();
    expect(component.detailText(component.groups[0])).toBe("a • b");
  });

  it("surfaces an error toast when an action fails", () => {
    const message = TestBed.inject(NzMessageService);
    reportServiceStub.listReports.mockReturnValue(of([entry({ wid: 100 })]));
    component.loadReports();

    reportServiceStub.dismissReports.mockReturnValue(throwError(() => ({ error: { message: "nope" } })));
    component.dismiss(component.groups[0]);
    expect(message.error).toHaveBeenCalledWith("nope");

    reportServiceStub.unpublishWorkflow.mockReturnValue(throwError(() => ({})));
    component.unpublish(component.groups[0]);

    reportServiceStub.setAuthorPublishing.mockReturnValue(throwError(() => ({})));
    component.setAuthorPublishing(component.groups[0], true);

    expect(message.error).toHaveBeenCalledTimes(3);
  });
});
