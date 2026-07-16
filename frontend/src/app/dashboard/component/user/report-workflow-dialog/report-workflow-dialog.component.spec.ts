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
import { of, throwError } from "rxjs";
import { NzMessageService } from "ng-zorro-antd/message";
import { NZ_MODAL_DATA, NzModalRef } from "ng-zorro-antd/modal";
import { ReportWorkflowDialogComponent } from "./report-workflow-dialog.component";
import { ReportService } from "../../../service/user/report/report.service";
import { commonTestProviders } from "../../../../common/testing/test-utils";

describe("ReportWorkflowDialogComponent", () => {
  let component: ReportWorkflowDialogComponent;
  let reportServiceStub: { reportWorkflow: ReturnType<typeof vi.fn> };
  let messageStub: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
  };
  let modalRefStub: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    reportServiceStub = { reportWorkflow: vi.fn().mockReturnValue(of(void 0)) };
    messageStub = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    modalRefStub = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ReportWorkflowDialogComponent],
      providers: [
        { provide: ReportService, useValue: reportServiceStub },
        { provide: NzMessageService, useValue: messageStub },
        { provide: NzModalRef, useValue: modalRefStub },
        { provide: NZ_MODAL_DATA, useValue: { wid: 42, name: "My workflow" } },
        ...commonTestProviders,
      ],
    });
    component = TestBed.createComponent(ReportWorkflowDialogComponent).componentInstance;
  });

  it("warns and does not submit when no reason is chosen", () => {
    component.reason = "";
    component.submit();

    expect(messageStub.warning).toHaveBeenCalled();
    expect(reportServiceStub.reportWorkflow).not.toHaveBeenCalled();
  });

  it("submits the trimmed reason and detail, then closes on success", () => {
    component.reason = "Harassment";
    component.detail = "  offensive text  ";
    component.submit();

    expect(reportServiceStub.reportWorkflow).toHaveBeenCalledWith(42, "Harassment", "offensive text");
    expect(messageStub.success).toHaveBeenCalled();
    expect(modalRefStub.close).toHaveBeenCalledWith(true);
    expect(component.submitting).toBe(false);
  });

  it("shows the backend error message and keeps the dialog open on failure", () => {
    reportServiceStub.reportWorkflow.mockReturnValue(
      throwError(() => ({ error: { message: "You have already reported this workflow." } }))
    );
    component.reason = "Other";
    component.submit();

    expect(messageStub.error).toHaveBeenCalledWith("You have already reported this workflow.");
    expect(modalRefStub.close).not.toHaveBeenCalled();
    expect(component.submitting).toBe(false);
  });

  it("closes with false when cancelled", () => {
    component.cancel();
    expect(modalRefStub.close).toHaveBeenCalledWith(false);
  });
});
