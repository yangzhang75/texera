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
import { AppSettings } from "../../../../common/app-setting";
import { Workflow } from "../../../../common/type/workflow";

export const TEMPLATED_WORKFLOW_BASE_URL = "templated-workflow";

/**
 * Client for the templated-workflow endpoints.
 *
 * - build: get-or-create the hidden preview workflow for a template (idempotent). Opening a
 *   template's build page shows this runnable preview; it is not listed as a real workflow.
 * - updateProperties: apply the user's configurable-property values to a workflow, server-side.
 *   The backend writes only properties whitelisted by each operator's configurableProperties, and
 *   stores the values as-is so typed values (e.g. file references) round-trip correctly.
 * - instantiate: 1-to-n. On Submit, create a brand-new workflow from the template and apply the
 *   submitted values to it. Every Submit yields a separate, fully-editable workflow.
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
   * 1-to-n Submit: create a new workflow from the template and apply the submitted configurable
   * properties to it. Returns the new workflow's wid. An optional name overrides the template name.
   */
  public instantiateTemplatedWorkflow(
    tid: number,
    request: { operatorProperties: Record<string, Record<string, unknown>>; name?: string }
  ): Observable<number> {
    return this.http.post<number>(
      `${AppSettings.getApiEndpoint()}/${TEMPLATED_WORKFLOW_BASE_URL}/instantiate?tid=${tid}`,
      request
    );
  }
}
