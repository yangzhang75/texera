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

import { Component, HostListener, Inject, OnDestroy, OnInit, Optional } from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { ActivatedRoute, Router } from "@angular/router";
import { UserService } from "../../../../common/service/user/user.service";
import { WorkflowActionService } from "../../../../workspace/service/workflow-graph/model/workflow-action.service";
import { Workflow } from "../../../../common/type/workflow";
import { isDefined } from "../../../../common/util/predicate";
import { Role, User } from "src/app/common/type/user";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { TemplateService } from "../../../../dashboard/service/user/template/template.service";
import { ShareAccessService } from "../../../../dashboard/service/user/share-access/share-access.service";
import { NZ_MODAL_DATA } from "ng-zorro-antd/modal";
import { HUB_TEMPLATE_RESULT, USER_TEMPLATE } from "../../../../app-routing.constant";
import { NgIf } from "@angular/common";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { ɵNzTransitionPatchDirective } from "ng-zorro-antd/core/transition-patch";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzWaveDirective } from "ng-zorro-antd/core/wave";
import { MarkdownDescriptionComponent } from "../../../../dashboard/component/user/markdown-description/markdown-description.component";
import { WorkflowEditorComponent } from "../../../../workspace/component/workflow-editor/workflow-editor.component";
import { MiniMapComponent } from "../../../../workspace/component/workflow-editor/mini-map/mini-map.component";

@UntilDestroy()
@Component({
  selector: "texera-hub-template-detail",
  templateUrl: "hub-template-detail.component.html",
  styleUrls: ["hub-template-detail.component.scss"],
  imports: [
    NgIf,
    NzButtonComponent,
    ɵNzTransitionPatchDirective,
    NzIconDirective,
    NzWaveDirective,
    MarkdownDescriptionComponent,
    WorkflowEditorComponent,
    MiniMapComponent,
  ],
})
export class HubTemplateDetailComponent implements OnDestroy, OnInit {
  isHub: boolean = false;
  templateName: string = "";
  ownerName: string = "";
  templateDescription: string = "";
  isLogin = this.userService.isLogin();
  isActivatedUser: boolean = false;
  tid: number | undefined;
  protected readonly currentUser?: User;

  constructor(
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private route: ActivatedRoute,
    private router: Router,
    private notificationService: NotificationService,
    private templateService: TemplateService,
    private shareAccessService: ShareAccessService,
    @Optional() @Inject(NZ_MODAL_DATA) public input: { tid: number } | undefined
  ) {
    this.tid = input?.tid; // from a modal, if opened that way
    if (!isDefined(this.tid)) {
      const routeId = this.route.snapshot.params.id;
      this.tid = isDefined(routeId) ? Number(routeId) : undefined;
      this.isHub = true;
    }
    this.currentUser = this.userService.getCurrentUser();
    if (this.currentUser?.role === Role.ADMIN || this.currentUser?.role === Role.REGULAR) {
      this.isActivatedUser = true;
    }
    this.workflowActionService.disableWorkflowModification();
  }

  ngOnInit() {
    if (!isDefined(this.tid)) {
      return;
    }

    this.shareAccessService
      .getOwner("template", this.tid)
      .pipe(untilDestroyed(this))
      .subscribe(ownerName => {
        this.ownerName = ownerName;
      });

    // Fetch the template once for name/description and to render a read-only preview of its content.
    // Done in ngOnInit (not ngAfterViewInit) so the bound name/description are set before the view is
    // checked; the async response and reloadWorkflow (which don't touch this component's bindings)
    // land after the embedded editor has initialized.
    this.templateService
      .retrieveTemplate(this.tid)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: template => {
          this.templateName = template.name;
          this.templateDescription = template.description || "No description available";
          const previewWorkflow: Workflow = {
            name: template.name,
            description: template.description,
            wid: undefined,
            creationTime: undefined,
            lastModifiedTime: undefined,
            isPublished: 0,
            readonly: true,
            content: template.content,
          };
          this.workflowActionService.reloadWorkflow(previewWorkflow);
          this.workflowActionService.getTexeraGraph().triggerCenterEvent();
        },
        error: () => {
          this.notificationService.error(`Failed to load template with id ${this.tid}`);
        },
      });
  }

  @HostListener("window:beforeunload")
  ngOnDestroy() {
    this.workflowActionService.clearWorkflow();
  }

  goBack(): void {
    this.router.navigateByUrl(HUB_TEMPLATE_RESULT).catch(() => {
      this.notificationService.error("Go back failed. Please try again.");
    });
  }

  /** Clone the template into the current user's own Templates tab (does not run it here). */
  cloneTemplate(): void {
    if (!isDefined(this.tid)) {
      return;
    }
    this.templateService
      .duplicateTemplate([this.tid])
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          this.router.navigateByUrl(USER_TEMPLATE).then(() => {
            this.notificationService.success("Template cloned to your Templates.");
          });
        },
        error: () => {
          this.notificationService.error("Failed to clone template.");
        },
      });
  }
}
