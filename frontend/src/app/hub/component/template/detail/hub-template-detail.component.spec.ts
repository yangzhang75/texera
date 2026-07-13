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

import { Component, Input } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { NzIconModule } from "ng-zorro-antd/icon";
import { NZ_MODAL_DATA } from "ng-zorro-antd/modal";
import { ArrowLeftOutline } from "@ant-design/icons-angular/icons";
import { of, throwError } from "rxjs";
import { vi } from "vitest";

import { HubTemplateDetailComponent } from "./hub-template-detail.component";
import { UserService } from "../../../../common/service/user/user.service";
import { StubUserService, MOCK_USER } from "../../../../common/service/user/stub-user.service";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { WorkflowActionService } from "../../../../workspace/service/workflow-graph/model/workflow-action.service";
import { TemplateService } from "../../../../dashboard/service/user/template/template.service";
import { ShareAccessService } from "../../../../dashboard/service/user/share-access/share-access.service";
import { Role } from "../../../../common/type/user";
import { HUB_TEMPLATE_RESULT, USER_TEMPLATE } from "../../../../app-routing.constant";
import { MarkdownDescriptionComponent } from "../../../../dashboard/component/user/markdown-description/markdown-description.component";
import { WorkflowEditorComponent } from "../../../../workspace/component/workflow-editor/workflow-editor.component";
import { MiniMapComponent } from "../../../../workspace/component/workflow-editor/mini-map/mini-map.component";
import { commonTestProviders } from "../../../../common/testing/test-utils";

@Component({ selector: "texera-markdown-description", standalone: true, template: "" })
class StubMarkdownDescriptionComponent {
  @Input() description?: string;
  @Input() enableViewMore?: boolean;
}

@Component({ selector: "texera-workflow-editor", standalone: true, template: "" })
class StubWorkflowEditorComponent {}

@Component({ selector: "texera-mini-map", standalone: true, template: "" })
class StubMiniMapComponent {}

const MOCK_TEMPLATE = {
  name: "Demo Template",
  description: "a description",
  tid: 1,
  creationTime: undefined,
  lastModifiedTime: undefined,
  isPublished: 0,
  readonly: false,
  content: { operators: [], operatorPositions: {}, links: [], commentBoxes: [], settings: {} } as any,
  configurableParameters: "",
};

describe("HubTemplateDetailComponent", () => {
  let fixture: ComponentFixture<HubTemplateDetailComponent>;
  let component: HubTemplateDetailComponent;

  let templateServiceMock: any;
  let shareAccessServiceMock: any;
  let workflowActionServiceMock: any;
  let notificationServiceMock: any;
  let routerMock: any;
  let stubGraph: { triggerCenterEvent: ReturnType<typeof vi.fn> };

  function makeMocks() {
    stubGraph = { triggerCenterEvent: vi.fn() };

    templateServiceMock = {
      retrieveTemplate: vi.fn().mockReturnValue(of(MOCK_TEMPLATE)),
      duplicateTemplate: vi.fn().mockReturnValue(of([MOCK_TEMPLATE])),
    };

    shareAccessServiceMock = { getOwner: vi.fn().mockReturnValue(of("owner")) };

    workflowActionServiceMock = {
      disableWorkflowModification: vi.fn(),
      reloadWorkflow: vi.fn(),
      clearWorkflow: vi.fn(),
      getTexeraGraph: vi.fn().mockReturnValue(stubGraph),
    };

    notificationServiceMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

    routerMock = {
      navigateByUrl: vi.fn().mockResolvedValue(true),
      navigate: vi.fn().mockResolvedValue(true),
    };
  }

  function configure(opts: { modalData?: { tid: number } | undefined; routeId?: string; userOverride?: any }) {
    TestBed.overrideComponent(HubTemplateDetailComponent, {
      remove: { imports: [WorkflowEditorComponent, MiniMapComponent, MarkdownDescriptionComponent] },
      add: { imports: [StubWorkflowEditorComponent, StubMiniMapComponent, StubMarkdownDescriptionComponent] },
    });

    TestBed.configureTestingModule({
      imports: [HubTemplateDetailComponent, NzIconModule.forChild([ArrowLeftOutline])],
      providers: [
        { provide: NZ_MODAL_DATA, useValue: opts.modalData },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { params: opts.routeId !== undefined ? { id: opts.routeId } : {} } },
        },
        { provide: Router, useValue: routerMock },
        { provide: TemplateService, useValue: templateServiceMock },
        { provide: ShareAccessService, useValue: shareAccessServiceMock },
        { provide: WorkflowActionService, useValue: workflowActionServiceMock },
        { provide: NotificationService, useValue: notificationServiceMock },
        { provide: UserService, useClass: StubUserService },
        ...commonTestProviders,
      ],
    });

    if ("userOverride" in opts) {
      (TestBed.inject(UserService) as unknown as StubUserService).user = opts.userOverride;
    }
  }

  function build(opts: {
    modalData?: { tid: number } | undefined;
    routeId?: string;
    userOverride?: any;
    detectChanges?: boolean;
  }) {
    configure(opts);
    fixture = TestBed.createComponent(HubTemplateDetailComponent);
    component = fixture.componentInstance;
    if (opts.detectChanges ?? true) {
      fixture.detectChanges();
    }
  }

  beforeEach(() => {
    makeMocks();
  });

  describe("constructor / tid resolution", () => {
    it("uses NZ_MODAL_DATA tid and leaves isHub false", () => {
      build({ modalData: { tid: 42 }, routeId: "11" });
      expect(component.tid).toBe(42);
      expect(component.isHub).toBe(false);
    });

    it("falls back to route.snapshot.params.id and sets isHub true", () => {
      build({ modalData: undefined, routeId: "11" });
      expect(component.tid).toBe(11);
      expect(component.isHub).toBe(true);
    });

    it("sets isActivatedUser true for REGULAR", () => {
      build({ modalData: { tid: 1 } });
      expect(component.isActivatedUser).toBe(true);
    });

    it("sets isActivatedUser true for ADMIN", () => {
      build({ modalData: { tid: 1 }, userOverride: { ...MOCK_USER, role: Role.ADMIN } });
      expect(component.isActivatedUser).toBe(true);
    });

    it("disables workflow modification", () => {
      build({ modalData: { tid: 1 } });
      expect(workflowActionServiceMock.disableWorkflowModification).toHaveBeenCalledTimes(1);
    });
  });

  describe("ngOnInit / template load", () => {
    it("early-returns when tid is undefined", () => {
      build({ modalData: undefined, routeId: undefined, detectChanges: false });
      component.ngOnInit();
      expect(shareAccessServiceMock.getOwner).not.toHaveBeenCalled();
      expect(templateServiceMock.retrieveTemplate).not.toHaveBeenCalled();
    });

    it("fetches the owner and loads the template (name/description + read-only preview)", () => {
      build({ modalData: { tid: 5 } });
      expect(shareAccessServiceMock.getOwner).toHaveBeenCalledWith("template", 5);
      expect(component.ownerName).toBe("owner");
      expect(templateServiceMock.retrieveTemplate).toHaveBeenCalledWith(5);
      expect(component.templateName).toBe(MOCK_TEMPLATE.name);
      expect(component.templateDescription).toBe(MOCK_TEMPLATE.description);
      const arg = workflowActionServiceMock.reloadWorkflow.mock.calls[0][0];
      expect(arg.content).toBe(MOCK_TEMPLATE.content);
      expect(arg.readonly).toBe(true);
      expect(arg.wid).toBeUndefined();
      expect(stubGraph.triggerCenterEvent).toHaveBeenCalledTimes(1);
    });

    it("falls back to a default description when the template has none", () => {
      templateServiceMock.retrieveTemplate.mockReturnValue(of({ ...MOCK_TEMPLATE, description: undefined }));
      build({ modalData: { tid: 5 } });
      expect(component.templateDescription).toBe("No description available");
    });

    it("notifies on load failure and does not reload", () => {
      templateServiceMock.retrieveTemplate.mockReturnValue(throwError(() => new Error("boom")));
      build({ modalData: { tid: 5 } });
      expect(workflowActionServiceMock.reloadWorkflow).not.toHaveBeenCalled();
      expect(notificationServiceMock.error).toHaveBeenCalledWith("Failed to load template with id 5");
    });
  });

  describe("ngOnDestroy", () => {
    it("clears the workflow", () => {
      build({ modalData: { tid: 1 } });
      component.ngOnDestroy();
      expect(workflowActionServiceMock.clearWorkflow).toHaveBeenCalled();
    });
  });

  describe("goBack", () => {
    it("navigates to HUB_TEMPLATE_RESULT", () => {
      build({ modalData: { tid: 1 } });
      component.goBack();
      expect(routerMock.navigateByUrl).toHaveBeenCalledWith(HUB_TEMPLATE_RESULT);
    });
  });

  describe("cloneTemplate", () => {
    it("early-returns when tid is undefined", () => {
      build({ modalData: undefined, routeId: undefined, detectChanges: false });
      component.cloneTemplate();
      expect(templateServiceMock.duplicateTemplate).not.toHaveBeenCalled();
    });

    it("duplicates the template and navigates to the user's Templates tab", async () => {
      build({ modalData: { tid: 7 } });
      component.cloneTemplate();
      expect(templateServiceMock.duplicateTemplate).toHaveBeenCalledWith([7]);
      expect(routerMock.navigateByUrl).toHaveBeenCalledWith(USER_TEMPLATE);
      await Promise.resolve();
      await Promise.resolve();
      expect(notificationServiceMock.success).toHaveBeenCalledWith("Template cloned to your Templates.");
    });

    it("notifies on clone failure", () => {
      templateServiceMock.duplicateTemplate.mockReturnValue(throwError(() => new Error("boom")));
      build({ modalData: { tid: 7 } });
      component.cloneTemplate();
      expect(notificationServiceMock.error).toHaveBeenCalledWith("Failed to clone template.");
    });
  });
});
