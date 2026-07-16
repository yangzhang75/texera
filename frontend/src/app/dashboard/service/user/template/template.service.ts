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
import { HttpClient, HttpParams } from "@angular/common/http";
import { Observable } from "rxjs";
import { AppSettings } from "../../../../common/app-setting";
import { Template } from "../../../../common/type/template";
import { WorkflowContent } from "../../../../common/type/workflow";
import { filter, map, switchMap } from "rxjs/operators";
import { DashboardTemplate } from "../../../type/dashboard-template.interface";
import { jsonCast } from "../../../../common/util/storage";
import { checkIfGraphBroken } from "../../../../common/util/graph-check";
import { NotificationService } from "../../../../common/service/notification/notification.service";

export const TEMPLATE_BASE_URL = "template";
export const TEMPLATE_PERSIST_URL = TEMPLATE_BASE_URL + "/persist";
export const TEMPLATE_CREATE_URL = TEMPLATE_BASE_URL + "/create";
export const TEMPLATE_CREATE_FROM_WORKFLOW_URL = TEMPLATE_BASE_URL + "/create-from-workflow";
export const TEMPLATE_LIST_URL = TEMPLATE_BASE_URL + "/list";
export const TEMPLATE_DUPLICATE_URL = TEMPLATE_BASE_URL + "/duplicate";
export const TEMPLATE_DELETE_URL = TEMPLATE_BASE_URL + "/delete";
export const TEMPLATE_SIZE = TEMPLATE_BASE_URL + "/size";

export const DEFAULT_TEMPLATE_NAME = "Untitled Template";

@Injectable({
  providedIn: "root",
})
export class TemplateService {
  private templatePersistFlag = true;

  constructor(
    private http: HttpClient,
    private notificationService: NotificationService
  ) {}

  public createTemplate(
    newTemplateContent: WorkflowContent,
    newTemplateName: string = DEFAULT_TEMPLATE_NAME,
    newTemplateConfigurableParameters: string = "{}"
  ): Observable<DashboardTemplate> {
    return this.http
      .post<DashboardTemplate>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_CREATE_URL}`, {
        name: newTemplateName,
        content: JSON.stringify(newTemplateContent),
        configurableParameters: newTemplateConfigurableParameters,
      })
      .pipe(filter((createdTemplate: DashboardTemplate) => createdTemplate != null));
  }

  public createTemplateFromWorkflow(wid: number): Observable<DashboardTemplate> {
    return this.http
      .post<DashboardTemplate>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_CREATE_FROM_WORKFLOW_URL}`, {
        wid: wid,
      })
      .pipe(filter((template: DashboardTemplate) => template != null));
  }

  public getTemplate(): Observable<{ tid: string; name: string }[]> {
    return this.http.get<{ tid: string; name: string }[]>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_LIST_URL}`);
  }

  public duplicateTemplate(targetTids: number[]): Observable<DashboardTemplate[]> {
    return this.http
      .post<DashboardTemplate[]>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_DUPLICATE_URL}`, {
        tids: targetTids,
      })
      .pipe(filter((createdTemplates: DashboardTemplate[]) => createdTemplates != null && createdTemplates.length > 0));
  }

  public retrieveTemplate(tid: number): Observable<Template> {
    return this.http.get<Template>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_BASE_URL}/${tid}`).pipe(
      filter((template: Template) => template != null),
      map(TemplateService.parseTemplateInfo)
    );
  }

  public deleteTemplate(tids: number[]): Observable<Response> {
    return this.http.post<Response>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_DELETE_URL}`, {
      tids: tids,
    });
  }

  public setTemplatePersistFlag(flag: boolean): void {
    this.templatePersistFlag = flag;
  }

  public isTemplatePersistEnabled(): boolean {
    return this.templatePersistFlag;
  }

  public persistTemplate(template: Template): Observable<Template> {
    if (checkIfGraphBroken(template.content)) {
      this.notificationService.error(
        "Sorry! The template is broken and cannot be persisted. Please contact the system admin."
      );
    }

    return this.http
      .post<Template>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_PERSIST_URL}`, {
        tid: template.tid,
        name: template.name,
        description: template.description,
        content: JSON.stringify(template.content),
        configurableParameters: template.configurableParameters,
      })
      .pipe(
        filter((updatedTemplate: Template) => updatedTemplate != null),
        map(TemplateService.parseTemplateInfo)
      );
  }

  /**
   * Rename a template from the dashboard list. There is no dedicated rename endpoint, so fetch the
   * template and persist it with the new name (the /persist endpoint enforces owner/write access).
   */
  public updateTemplateName(tid: number, name: string): Observable<Template> {
    return this.retrieveTemplate(tid).pipe(switchMap(template => this.persistTemplate({ ...template, name })));
  }

  public getSizes(tids: number[]): Observable<Record<number, number>> {
    let params = new HttpParams();
    tids.forEach(tid => {
      params = params.append("tid", tid.toString());
    });
    return this.http.get<Record<number, number>>(`${AppSettings.getApiEndpoint()}/${TEMPLATE_SIZE}`, { params });
  }

  public static parseTemplateInfo(template: Template): Template {
    if (template != null && typeof template.content === "string") {
      template.content = jsonCast<WorkflowContent>(template.content);
    }
    return template;
  }
}
