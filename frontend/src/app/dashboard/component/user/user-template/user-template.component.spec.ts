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

import { of, Subject } from "rxjs";
import { UserTemplateComponent } from "./user-template.component";
import { USER_TEMPLATE } from "../../../../app-routing.constant";
import { DEFAULT_TEMPLATE_NAME } from "../../../service/user/template/template.service";
import { SortMethod } from "../../../type/sort-method";
import { User } from "../../../../common/type/user";

type LoadMoreFn = (start: number, count: number) => Promise<{ entries: any[]; more: boolean }>;

describe("UserTemplateComponent", () => {
  let component: UserTemplateComponent;

  let userChangedSubject: Subject<User | undefined>;
  let isLoginSpy: ReturnType<typeof vi.fn>;
  let getCurrentUserSpy: ReturnType<typeof vi.fn>;

  let modalServiceMock: any;
  let routerMock: { navigate: ReturnType<typeof vi.fn> };
  let notificationServiceMock: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
  let downloadServiceMock: { downloadTemplatesAsZip: ReturnType<typeof vi.fn> };
  let searchServiceMock: { executeSearch: ReturnType<typeof vi.fn>; getUserInfo: ReturnType<typeof vi.fn> };
  let datasetServiceMock: any;
  let templateServiceMock: {
    createTemplate: ReturnType<typeof vi.fn>;
    deleteTemplate: ReturnType<typeof vi.fn>;
    duplicateTemplate: ReturnType<typeof vi.fn>;
  };
  let messageMock: any;
  let configMock: any;

  let filtersStub: any;
  let searchResultsStub: any;
  let capturedLoadMoreFn: LoadMoreFn | null;

  const buildEntry = (tid: number | undefined, name = `template-${tid}`, checked = false) =>
    ({
      type: "template",
      checked,
      template: { template: { tid, name } },
    }) as any;

  beforeEach(() => {
    userChangedSubject = new Subject<User | undefined>();
    isLoginSpy = vi.fn(() => true);
    getCurrentUserSpy = vi.fn(() => ({ uid: 42 }) as User);

    const userServiceMock = {
      userChanged: () => userChangedSubject.asObservable(),
      isLogin: isLoginSpy,
      getCurrentUser: getCurrentUserSpy,
    };

    modalServiceMock = { create: vi.fn() };
    routerMock = { navigate: vi.fn(() => Promise.resolve(true)) };
    notificationServiceMock = { error: vi.fn(), success: vi.fn() };
    downloadServiceMock = { downloadTemplatesAsZip: vi.fn(() => of(new Blob())) };
    searchServiceMock = {
      executeSearch: vi.fn(() => of({ entries: [], more: false })),
      getUserInfo: vi.fn(() => of({})),
    };
    datasetServiceMock = {};
    templateServiceMock = {
      createTemplate: vi.fn(() => of({ template: { tid: 7 } })),
      deleteTemplate: vi.fn(() => of({} as Response)),
      duplicateTemplate: vi.fn(() => of([])),
    };
    messageMock = { warning: vi.fn() };
    configMock = { env: { defaultDataTransferBatchSize: 400, defaultExecutionMode: "BATCH" } };

    component = new UserTemplateComponent(
      modalServiceMock,
      userServiceMock as any,
      notificationServiceMock as any,
      routerMock as any,
      downloadServiceMock as any,
      searchServiceMock as any,
      datasetServiceMock,
      templateServiceMock as any,
      messageMock,
      configMock
    );

    capturedLoadMoreFn = null;
    filtersStub = {
      masterFilterList: [] as string[],
      masterFilterListChange: new Subject<void>(),
      getSearchKeywords: vi.fn(() => ["kw1"]),
      getSearchFilterParameters: vi.fn(() => ({ ids: [1, 2] })),
    };
    searchResultsStub = {
      entries: [] as any[],
      reset: vi.fn((fn: LoadMoreFn) => {
        capturedLoadMoreFn = fn;
      }),
      loadMore: vi.fn(async () => {}),
      clearAllSelections: vi.fn(),
      selectAll: vi.fn(),
    };

    component.filters = filtersStub;
    component.searchResultsComponent = searchResultsStub;
  });

  describe("user state tracking", () => {
    it("updates isLogin and currentUid when userChanged emits", () => {
      expect(component.isLogin).toBe(true);
      expect(component.currentUid).toBe(42);

      isLoginSpy.mockReturnValue(false);
      getCurrentUserSpy.mockReturnValue(undefined);
      userChangedSubject.next(undefined);

      expect(component.isLogin).toBe(false);
      expect(component.currentUid).toBeUndefined();
    });
  });

  describe("search", () => {
    it('passes the "template" resource type and login/includePublic flags through executeSearch', async () => {
      component.isLogin = true;
      component.sortMethod = SortMethod.EditTimeDesc;

      await component.search();
      expect(searchResultsStub.reset).toHaveBeenCalledTimes(1);
      expect(searchResultsStub.loadMore).toHaveBeenCalledTimes(1);
      expect(capturedLoadMoreFn).not.toBeNull();

      await capturedLoadMoreFn!(5, 10);
      expect(searchServiceMock.executeSearch).toHaveBeenCalledWith(
        ["kw1"],
        { ids: [1, 2] },
        5,
        10,
        "template",
        SortMethod.EditTimeDesc,
        true,
        false
      );
    });
  });

  describe("onClickCreateNewTemplateFromDashboard", () => {
    it("creates an empty template and navigates to /user/template/<tid>", () => {
      component.onClickCreateNewTemplateFromDashboard();

      expect(templateServiceMock.createTemplate).toHaveBeenCalledTimes(1);
      expect(templateServiceMock.createTemplate.mock.calls[0][1]).toBe(DEFAULT_TEMPLATE_NAME);
      expect(routerMock.navigate).toHaveBeenCalledWith([USER_TEMPLATE, 7]);
    });

    it("reports an error via the notification service when creation fails", () => {
      templateServiceMock.createTemplate.mockReturnValue(of({ template: { tid: undefined } }));

      component.onClickCreateNewTemplateFromDashboard();

      expect(notificationServiceMock.error).toHaveBeenCalledTimes(1);
      expect(routerMock.navigate).not.toHaveBeenCalled();
    });
  });

  describe("deleteTemplate", () => {
    it("is a no-op when entry.template.template.tid is undefined", () => {
      component.deleteTemplate(buildEntry(undefined));
      expect(templateServiceMock.deleteTemplate).not.toHaveBeenCalled();
    });

    it("calls deleteTemplate([tid]) and filters the entry out of searchResultsComponent.entries", () => {
      const e1 = buildEntry(1);
      const e2 = buildEntry(2);
      const e3 = buildEntry(3);
      searchResultsStub.entries = [e1, e2, e3];

      component.deleteTemplate(e2);

      expect(templateServiceMock.deleteTemplate).toHaveBeenCalledWith([2]);
      expect(searchResultsStub.entries).toEqual([e1, e3]);
    });
  });

  describe("onClickOpenDownloadZip", () => {
    it("is a no-op when nothing is checked", () => {
      searchResultsStub.entries = [buildEntry(1), buildEntry(2)];
      component.onClickOpenDownloadZip();
      expect(downloadServiceMock.downloadTemplatesAsZip).not.toHaveBeenCalled();
    });

    it("downloads only the checked templates as a ZIP", () => {
      searchResultsStub.entries = [buildEntry(1, "a", true), buildEntry(2, "b", false), buildEntry(3, "c", true)];

      component.onClickOpenDownloadZip();

      expect(downloadServiceMock.downloadTemplatesAsZip).toHaveBeenCalledWith([
        { id: 1, name: "a" },
        { id: 3, name: "c" },
      ]);
    });
  });

  describe("toggleSelection", () => {
    it("selects all when not everything is selected", () => {
      searchResultsStub.entries = [buildEntry(1, "a", false), buildEntry(2, "b", true)];
      component.toggleSelection();
      expect(searchResultsStub.selectAll).toHaveBeenCalledTimes(1);
      expect(searchResultsStub.clearAllSelections).not.toHaveBeenCalled();
    });

    it("clears all when everything is already selected", () => {
      searchResultsStub.entries = [buildEntry(1, "a", true), buildEntry(2, "b", true)];
      component.toggleSelection();
      expect(searchResultsStub.clearAllSelections).toHaveBeenCalledTimes(1);
      expect(searchResultsStub.selectAll).not.toHaveBeenCalled();
    });
  });
});
