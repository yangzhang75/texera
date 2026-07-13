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

import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { AppSettings } from "../../../../common/app-setting";

export const REPORT_BASE_URL = `${AppSettings.getApiEndpoint()}/report`;

/** Predefined reasons offered to the user when reporting a public workflow. */
export const REPORT_REASONS: ReadonlyArray<string> = [
  "Offensive / hateful content",
  "Harassment",
  "Spam / advertising",
  "Copyright / privacy violation",
  "Other",
];

/** Moderation notice shown to a workflow owner whose workflow was unpublished. */
export interface ModerationNotice {
  unpublished: boolean;
  reasons: string[];
  resolvedTime: number | null;
}

/** A pending report as returned by the admin moderation endpoint. */
export interface WorkflowReportEntry {
  reportId: number;
  wid: number;
  workflowName: string;
  isPublic: boolean;
  reporterName: string;
  ownerUid: number;
  ownerName: string;
  ownerPublishDisabled: boolean;
  reason: string;
  detail: string | null;
  status: string;
  creationTime: number;
}

@Injectable({
  providedIn: "root",
})
export class ReportService {
  constructor(private http: HttpClient) {}

  /** File a report against a public workflow. */
  public reportWorkflow(wid: number, reason: string, detail: string): Observable<void> {
    return this.http.post<void>(`${REPORT_BASE_URL}/${wid}`, { reason, detail });
  }

  /** List all pending reports (admin only). */
  public listReports(): Observable<ReadonlyArray<WorkflowReportEntry>> {
    return this.http.get<ReadonlyArray<WorkflowReportEntry>>(`${REPORT_BASE_URL}/list`);
  }

  /** Dismiss the pending reports for a workflow without taking action (admin only). */
  public dismissReports(wid: number): Observable<void> {
    return this.http.put<void>(`${REPORT_BASE_URL}/dismiss/${wid}`, {});
  }

  /** Unpublish a reported workflow and mark its reports as actioned (admin only). */
  public unpublishWorkflow(wid: number): Observable<void> {
    return this.http.put<void>(`${REPORT_BASE_URL}/unpublish/${wid}`, {});
  }

  /** IDs of the current user's own workflows that were unpublished by moderation. */
  public getModeratedWorkflows(): Observable<ReadonlyArray<number>> {
    return this.http.get<ReadonlyArray<number>>(`${REPORT_BASE_URL}/moderated`);
  }

  /** Whether a specific workflow was unpublished by moderation (owner only). */
  public getModerationNotice(wid: number): Observable<ModerationNotice> {
    return this.http.get<ModerationNotice>(`${REPORT_BASE_URL}/moderation/${wid}`);
  }

  /** Suspend or restore a user's right to publish workflows (admin only). */
  public setAuthorPublishing(uid: number, disabled: boolean): Observable<void> {
    return this.http.put<void>(`${REPORT_BASE_URL}/author/${uid}/publishing`, { disabled });
  }
}
