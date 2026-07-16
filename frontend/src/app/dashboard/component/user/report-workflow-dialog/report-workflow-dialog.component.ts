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

import { Component, inject } from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { NgFor } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzWaveDirective } from "ng-zorro-antd/core/wave";
import { NzInputDirective } from "ng-zorro-antd/input";
import { NzSelectComponent } from "ng-zorro-antd/select";
import { NzOptionComponent } from "ng-zorro-antd/select";
import { NzMessageService } from "ng-zorro-antd/message";
import { NZ_MODAL_DATA, NzModalRef } from "ng-zorro-antd/modal";
import { ReportService, REPORT_REASONS } from "../../../service/user/report/report.service";

/**
 * A small dialog for reporting a public workflow. Opened as modal content with
 * `{ wid, name }` injected via NZ_MODAL_DATA. Submits the report and closes itself.
 */
@UntilDestroy()
@Component({
  selector: "texera-report-workflow-dialog",
  templateUrl: "./report-workflow-dialog.component.html",
  styleUrls: ["./report-workflow-dialog.component.scss"],
  imports: [NgFor, FormsModule, NzButtonComponent, NzWaveDirective, NzInputDirective, NzSelectComponent, NzOptionComponent],
})
export class ReportWorkflowDialogComponent {
  readonly reasons = REPORT_REASONS;
  readonly data = inject(NZ_MODAL_DATA) as { wid: number; name: string };
  reason: string = "";
  detail: string = "";
  submitting: boolean = false;

  constructor(
    private reportService: ReportService,
    private messageService: NzMessageService,
    private modalRef: NzModalRef
  ) {}

  submit(): void {
    if (!this.reason) {
      this.messageService.warning("Please choose a reason.");
      return;
    }
    this.submitting = true;
    this.reportService
      .reportWorkflow(this.data.wid, this.reason, this.detail.trim())
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          this.submitting = false;
          this.messageService.success("Report submitted. Thank you for helping keep the Hub safe.");
          this.modalRef.close(true);
        },
        error: (err: unknown) => {
          this.submitting = false;
          this.messageService.error((err as any)?.error?.message || "Failed to submit report. Please try again.");
        },
      });
  }

  cancel(): void {
    this.modalRef.close(false);
  }
}
