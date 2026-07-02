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
import { BehaviorSubject, Observable, of } from "rxjs";
import { catchError, map } from "rxjs/operators";
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
  // Latest wid->tid map, shared with every workflow-list item. Refreshed (via
  // refreshTemplatedWorkflowTidMap) whenever list items render, so any newly-built template
  // workflow gets badged automatically -- no page reload needed.
  private readonly tidMapSubject = new BehaviorSubject<ReadonlyMap<number, number>>(new Map());
  private tidMapRefreshInFlight = false;

  constructor(private http: HttpClient) {}

  /**
   * Lists every workflow<->template link (wid + tid) visible to the user. The dashboard intersects
   * this with the workflows it already shows, to badge the template-built ones and route a click to
   * the template-editing page.
   */
  public listTemplatedWorkflows(): Observable<{ wid: number; tid: number }[]> {
    return this.http.get<{ wid: number; tid: number }[]>(
      `${AppSettings.getApiEndpoint()}/${TEMPLATED_WORKFLOW_BASE_URL}/list`
    );
  }

  /**
   * The latest wid->tid map (which workflows were built from a template). Subscribe to badge list
   * items; call refreshTemplatedWorkflowTidMap() to pull the current server state.
   */
  public getTemplatedWorkflowTidMap(): Observable<ReadonlyMap<number, number>> {
    return this.tidMapSubject.asObservable();
  }

  /**
   * Re-fetch the wid->tid map from the server and push it to all subscribers. De-duplicated so a
   * burst of list items renders only one request. Called as list items render, so a template
   * workflow created at any time shows its badge as soon as it appears in the list -- no reload.
   * Fails silently (keeps the previous map) if the endpoint is unavailable, so the list never breaks.
   */
  public refreshTemplatedWorkflowTidMap(): void {
    if (this.tidMapRefreshInFlight) {
      return;
    }
    this.tidMapRefreshInFlight = true;
    this.listTemplatedWorkflows()
      .pipe(
        map(links => new Map(links.map(link => [link.wid, link.tid])) as ReadonlyMap<number, number>),
        catchError(() => of(this.tidMapSubject.value))
      )
      .subscribe(tidMap => {
        this.tidMapRefreshInFlight = false;
        this.tidMapSubject.next(tidMap);
      });
  }

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
}
