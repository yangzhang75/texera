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
import { Observable, of } from "rxjs";
import { catchError, map, shareReplay } from "rxjs/operators";
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
  // Shared wid->tid stream. Fetched once while there are active subscribers (a single workflow-list
  // render), then RESET when the last one unsubscribes (refCount) -- so re-opening the list always
  // re-fetches and newly-created template workflows show up. Not permanently cached.
  private tidMap$?: Observable<ReadonlyMap<number, number>>;

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
   * A wid->tid map so the workflow list can tell which workflows were built from a template. Shared
   * among the current list items (one HTTP call per list render) but re-fetched every time the list
   * is re-opened (refCount), so newly-built template workflows appear. Degrades gracefully to an
   * empty map if the endpoint is unavailable (e.g. an older backend), so the list never breaks.
   */
  public getTemplatedWorkflowTidMap(): Observable<ReadonlyMap<number, number>> {
    if (!this.tidMap$) {
      this.tidMap$ = this.listTemplatedWorkflows().pipe(
        map(links => new Map(links.map(link => [link.wid, link.tid])) as ReadonlyMap<number, number>),
        catchError(() => of(new Map<number, number>() as ReadonlyMap<number, number>)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.tidMap$;
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
