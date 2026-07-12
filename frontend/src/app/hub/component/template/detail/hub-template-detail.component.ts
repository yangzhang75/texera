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
import { throttleTime } from "rxjs/operators";
import { UserService } from "../../../../common/service/user/user.service";
import { WorkflowActionService } from "../../../../workspace/service/workflow-graph/model/workflow-action.service";
import { Workflow } from "../../../../common/type/workflow";
import { isDefined } from "../../../../common/util/predicate";
import { ActionType, EntityType, HubService, LikedStatus } from "../../../service/hub.service";
import { Role, User } from "src/app/common/type/user";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { TemplateService } from "../../../../dashboard/service/user/template/template.service";
import { ShareAccessService } from "../../../../dashboard/service/user/share-access/share-access.service";
import { NZ_MODAL_DATA } from "ng-zorro-antd/modal";
import { HUB_TEMPLATE_RESULT, USER_TEMPLATE } from "../../../../app-routing.constant";
import { NgIf, NgClass } from "@angular/common";
import { NzSpaceCompactItemDirective } from "ng-zorro-antd/space";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { ɵNzTransitionPatchDirective } from "ng-zorro-antd/core/transition-patch";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzWaveDirective } from "ng-zorro-antd/core/wave";
import { MarkdownDescriptionComponent } from "../../../../dashboard/component/user/markdown-description/markdown-description.component";
import { WorkflowEditorComponent } from "../../../../workspace/component/workflow-editor/workflow-editor.component";
import { MiniMapComponent } from "../../../../workspace/component/workflow-editor/mini-map/mini-map.component";
import { formatCount } from "../../../../common/util/format.util";

export const THROTTLE_TIME_MS = 1000;

@UntilDestroy()
@Component({
  selector: "texera-hub-template-detail",
  templateUrl: "hub-template-detail.component.html",
  styleUrls: ["hub-template-detail.component.scss"],
  imports: [
    NgIf,
    NzSpaceCompactItemDirective,
    NzButtonComponent,
    ɵNzTransitionPatchDirective,
    NzIconDirective,
    NzWaveDirective,
    NgClass,
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
  isLiked: boolean = false;
  likeCount: number = 0;
  cloneCount: number = 0;
  displayPreciseViewCount = false;
  viewCount: number = 0;
  tid: number | undefined;
  protected readonly currentUser?: User;

  constructor(
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private route: ActivatedRoute,
    private router: Router,
    private notificationService: NotificationService,
    private hubService: HubService,
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

    this.hubService
      .getCounts([EntityType.Template], [this.tid], [ActionType.Like, ActionType.Clone])
      .pipe(untilDestroyed(this))
      .subscribe(counts => {
        this.likeCount = counts[0].counts.like ?? 0;
        this.cloneCount = counts[0].counts.clone ?? 0;
      });
    this.hubService
      .postView(this.tid, this.currentUser?.uid ?? 0, EntityType.Template)
      .pipe(throttleTime(THROTTLE_TIME_MS))
      .pipe(untilDestroyed(this))
      .subscribe(count => {
        this.viewCount = count;
      });
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

    if (!isDefined(this.currentUser)) {
      return;
    }
    this.hubService
      .isLiked([this.tid], [EntityType.Template])
      .pipe(untilDestroyed(this))
      .subscribe((isLiked: LikedStatus[]) => {
        this.isLiked = isLiked.length > 0 ? isLiked[0].isLiked : false;
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

  toggleLike(): void {
    const userId = this.currentUser?.uid;
    if (!isDefined(userId) || !isDefined(this.tid)) {
      return;
    }
    const refreshLikeCount = () => {
      if (!isDefined(this.tid)) {
        return;
      }
      this.hubService
        .getCounts([EntityType.Template], [this.tid], [ActionType.Like])
        .pipe(untilDestroyed(this))
        .subscribe(counts => {
          this.likeCount = counts[0].counts.like ?? 0;
        });
    };
    if (this.isLiked) {
      this.hubService
        .postUnlike(this.tid, EntityType.Template)
        .pipe(untilDestroyed(this))
        .subscribe((success: boolean) => {
          if (success) {
            this.isLiked = false;
            refreshLikeCount();
          }
        });
    } else {
      this.hubService
        .postLike(this.tid, EntityType.Template)
        .pipe(untilDestroyed(this))
        .subscribe((success: boolean) => {
          if (success) {
            this.isLiked = true;
            refreshLikeCount();
          }
        });
    }
  }

  formatCount = formatCount;

  changeViewDisplayStyle() {
    this.displayPreciseViewCount = !this.displayPreciseViewCount;
  }
}
