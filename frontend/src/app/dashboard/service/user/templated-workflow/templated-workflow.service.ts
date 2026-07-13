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
import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { map, shareReplay } from "rxjs/operators";
import { AppSettings } from "../../../../common/app-setting";
import { Workflow } from "../../../../common/type/workflow";

export const TEMPLATED_WORKFLOW_BASE_URL = "templated-workflow";

/**
 * Client for the templated-workflow endpoints.
 *
 * - build: get-or-create the workflow instantiated from a template (idempotent).
 * - updateProperties: apply the user's configurable-property values to that workflow, server-side.
 *   The backend writes only properties whitelisted by each operator's configurableProperties, and
 *   stores the values as-is so typed values (e.g. file references) round-trip correctly.
 */
@Injectable({
  providedIn: "root",
})
export class TemplatedWorkflowService {
  constructor(private http: HttpClient) {}

  public createTemplatedWorkflow(tid: number): Observable<number> {
    return this.http.post<number>(
      `${AppSettings.getApiEndpoint()}/${TEMPLATED_WORKFLOW_BASE_URL}/build?tid=${tid}`,
      {}
    );
  }

  /** Every workflow<->template link (wid, tid); used to tag workflows created from a template. */
  public listTemplatedWorkflows(): Observable<{ wid: number; tid: number }[]> {
    return this.http.get<{ wid: number; tid: number }[]>(
      `${AppSettings.getApiEndpoint()}/${TEMPLATED_WORKFLOW_BASE_URL}/list`
    );
  }

  private templatedWids$?: Observable<Set<number>>;

  /**
   * Set of wids created from a template, cached (shareReplay) so many list items share one request.
   * Refreshed on page reload; call resetTemplatedWorkflowCache() to force a refetch.
   */
  public getTemplatedWorkflowWids(): Observable<Set<number>> {
    if (!this.templatedWids$) {
      this.templatedWids$ = this.listTemplatedWorkflows().pipe(
        map(list => new Set(list.map(l => l.wid))),
        shareReplay(1)
      );
    }
    return this.templatedWids$;
  }

  public resetTemplatedWorkflowCache(): void {
    this.templatedWids$ = undefined;
  }

  public updateTemplatedWorkflowProperties(
    wid: number,
    request: { operatorProperties: Record<string, Record<string, unknown>> }
  ): Observable<Workflow> {
    return this.http.post<Workflow>(
      `${AppSettings.getApiEndpoint()}/${TEMPLATED_WORKFLOW_BASE_URL}/${wid}/update`,
      request
    );
  }

  /**
   * 1-to-n: create a brand-new workflow from the template with the given configurable properties.
   * Every call yields a separate workflow (tagged "created from template"). Returns the new wid.
   */
  public instantiateTemplatedWorkflow(
    tid: number,
    request: { operatorProperties: Record<string, Record<string, unknown>> }
  ): Observable<number> {
    return this.http.post<number>(
      `${AppSettings.getApiEndpoint()}/${TEMPLATED_WORKFLOW_BASE_URL}/instantiate?tid=${tid}`,
      request
    );
  }
}
