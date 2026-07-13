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

import { Component, OnInit } from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { NgFor, NgIf, DatePipe } from "@angular/common";
import { NzCardComponent } from "ng-zorro-antd/card";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzWaveDirective } from "ng-zorro-antd/core/wave";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzPopconfirmDirective } from "ng-zorro-antd/popconfirm";
import { NzDropdownDirective, NzDropdownMenuComponent } from "ng-zorro-antd/dropdown";
import { NzMenuDirective, NzMenuItemComponent } from "ng-zorro-antd/menu";
import { NzTooltipDirective } from "ng-zorro-antd/tooltip";
import {
  NzTableComponent,
  NzTheadComponent,
  NzTrDirective,
  NzTableCellDirective,
  NzThMeasureDirective,
  NzTbodyComponent,
} from "ng-zorro-antd/table";
import { NzMessageService } from "ng-zorro-antd/message";
import { HUB_WORKFLOW_RESULT_DETAIL } from "../../../../app-routing.constant";
import { ReportService, WorkflowReportEntry } from "../../../service/user/report/report.service";

/** One row of the admin moderation table: all pending reports for a single workflow. */
interface ReportGroup {
  wid: number;
  workflowName: string;
  ownerUid: number;
  ownerName: string;
  ownerPublishDisabled: boolean;
  isPublic: boolean;
  reportCount: number;
  reasons: string;
  reporters: string;
  details: string[];
  latestTime: number;
}

@UntilDestroy()
@Component({
  templateUrl: "./admin-report.component.html",
  styleUrls: ["./admin-report.component.scss"],
  imports: [
    NgFor,
    NgIf,
    DatePipe,
    NzCardComponent,
    NzButtonComponent,
    NzWaveDirective,
    NzIconDirective,
    NzPopconfirmDirective,
    NzDropdownDirective,
    NzDropdownMenuComponent,
    NzMenuDirective,
    NzMenuItemComponent,
    NzTooltipDirective,
    NzTableComponent,
    NzTheadComponent,
    NzTrDirective,
    NzTableCellDirective,
    NzThMeasureDirective,
    NzTbodyComponent,
  ],
})
export class AdminReportComponent implements OnInit {
  groups: ReportGroup[] = [];
  loading: boolean = false;

  constructor(
    private reportService: ReportService,
    private messageService: NzMessageService
  ) {}

  ngOnInit(): void {
    this.loadReports();
  }

  /**
   * Read-only public Hub detail page for the workflow, so the admin can inspect it
   * before acting. Opened in a new tab: this route renders the public (non-editable)
   * view and keeps the moderation queue intact in the current tab.
   */
  detailLink(wid: number): string {
    return `${HUB_WORKFLOW_RESULT_DETAIL}/${wid}`;
  }

  /** All report details for a workflow, joined for the hover tooltip. */
  detailText(group: ReportGroup): string {
    return group.details.join(" • ");
  }

  loadReports(): void {
    this.loading = true;
    this.reportService
      .listReports()
      .pipe(untilDestroyed(this))
      .subscribe({
        next: reports => {
          this.groups = this.groupByWorkflow(reports);
          this.loading = false;
        },
        error: (err: unknown) => {
          this.loading = false;
          this.messageService.error((err as any)?.error?.message || "Failed to load reports.");
        },
      });
  }

  dismiss(group: ReportGroup): void {
    this.reportService
      .dismissReports(group.wid)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          this.messageService.success(`Dismissed reports for "${group.workflowName}".`);
          this.loadReports();
        },
        error: (err: unknown) =>
          this.messageService.error((err as any)?.error?.message || "Failed to dismiss reports."),
      });
  }

  unpublish(group: ReportGroup): void {
    this.reportService
      .unpublishWorkflow(group.wid)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          this.messageService.success(`Unpublished "${group.workflowName}".`);
          this.loadReports();
        },
        error: (err: unknown) =>
          this.messageService.error((err as any)?.error?.message || "Failed to unpublish workflow."),
      });
  }

  setAuthorPublishing(group: ReportGroup, disabled: boolean): void {
    this.reportService
      .setAuthorPublishing(group.ownerUid, disabled)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          this.messageService.success(
            disabled ? `Suspended publishing for ${group.ownerName}.` : `Restored publishing for ${group.ownerName}.`
          );
          this.loadReports();
        },
        error: (err: unknown) =>
          this.messageService.error((err as any)?.error?.message || "Failed to update publishing right."),
      });
  }

  private groupByWorkflow(reports: ReadonlyArray<WorkflowReportEntry>): ReportGroup[] {
    const byWid = new Map<number, WorkflowReportEntry[]>();
    for (const report of reports) {
      const list = byWid.get(report.wid) ?? [];
      list.push(report);
      byWid.set(report.wid, list);
    }

    const groups: ReportGroup[] = [];
    byWid.forEach((list, wid) => {
      const reasonCounts = new Map<string, number>();
      for (const r of list) {
        reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
      }
      const reasons = Array.from(reasonCounts.entries())
        .map(([reason, count]) => (count > 1 ? `${reason} (${count})` : reason))
        .join(", ");
      const reporters = Array.from(new Set(list.map(r => r.reporterName))).join(", ");
      const details = list.map(r => (r.detail ?? "").trim()).filter(detail => detail.length > 0);
      const latest = list.reduce((a, b) => (b.creationTime > a.creationTime ? b : a));
      groups.push({
        wid,
        workflowName: latest.workflowName,
        ownerUid: latest.ownerUid,
        ownerName: latest.ownerName,
        ownerPublishDisabled: latest.ownerPublishDisabled,
        isPublic: latest.isPublic,
        reportCount: list.length,
        reasons,
        reporters,
        details,
        latestTime: latest.creationTime,
      });
    });

    // Most-reported first, then most recent.
    return groups.sort((a, b) => b.reportCount - a.reportCount || b.latestTime - a.latestTime);
  }
}
