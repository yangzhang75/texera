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
import { SearchResultsComponent } from "./search-results.component";
import { UserService } from "../../../../common/service/user/user.service";
import { ReportService } from "../../../service/user/report/report.service";
import { DashboardEntry } from "../../../type/dashboard-entry";
import { commonTestProviders } from "../../../../common/testing/test-utils";

describe("SearchResultsComponent (moderation flag)", () => {
  let component: SearchResultsComponent;
  let reportServiceStub: { getModeratedWorkflows: ReturnType<typeof vi.fn> };
  const noopLoad = async () => ({ entries: [], more: false });
  const entry = (type: string, id: number) => ({ type, id }) as unknown as DashboardEntry;

  beforeEach(() => {
    reportServiceStub = { getModeratedWorkflows: vi.fn().mockReturnValue(of([5, 7])) };
    TestBed.configureTestingModule({
      imports: [SearchResultsComponent],
      providers: [
        { provide: UserService, useValue: { getCurrentUser: () => undefined } },
        { provide: ReportService, useValue: reportServiceStub },
        ...commonTestProviders,
      ],
    });
    component = TestBed.createComponent(SearchResultsComponent).componentInstance;
  });

  it("does not fetch moderated workflows for a public/hub search", () => {
    component.isPrivateSearch = false;
    component.reset(noopLoad);

    expect(reportServiceStub.getModeratedWorkflows).not.toHaveBeenCalled();
    expect(component.isModerated(entry("workflow", 5))).toBe(false);
  });

  it("flags only the user's own moderated workflows on a private search", () => {
    component.isPrivateSearch = true;
    component.reset(noopLoad);

    expect(reportServiceStub.getModeratedWorkflows).toHaveBeenCalledTimes(1);
    expect(component.isModerated(entry("workflow", 5))).toBe(true);
    expect(component.isModerated(entry("workflow", 99))).toBe(false); // not reported
    expect(component.isModerated(entry("dataset", 5))).toBe(false); // not a workflow
  });

  it("flags nothing when the moderated-workflows lookup fails", () => {
    reportServiceStub.getModeratedWorkflows.mockReturnValue(throwError(() => ({})));
    component.isPrivateSearch = true;
    component.reset(noopLoad);

    expect(component.isModerated(entry("workflow", 5))).toBe(false);
  });
});
