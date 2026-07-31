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

import { AfterViewInit, Component, HostListener, OnDestroy, OnInit } from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { ActivatedRoute, Router } from "@angular/router";
import { NgIf } from "@angular/common";
import { firstValueFrom } from "rxjs";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzTooltipModule } from "ng-zorro-antd/tooltip";
import { WorkflowActionService } from "../../../../workspace/service/workflow-graph/model/workflow-action.service";
import { OperatorMetadataService } from "../../../../workspace/service/operator-metadata/operator-metadata.service";
import { WorkflowPersistService } from "../../../../common/service/workflow-persist/workflow-persist.service";
import { MacroService, MacroDetail } from "../../../../workspace/service/macro/macro.service";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { isDefined } from "../../../../common/util/predicate";
import { HUB_MACRO_RESULT, USER_MACRO_OPEN } from "../../../../app-routing.constant";
import { WorkflowEditorComponent } from "../../../../workspace/component/workflow-editor/workflow-editor.component";
import { MiniMapComponent } from "../../../../workspace/component/workflow-editor/mini-map/mini-map.component";
import { MarkdownDescriptionComponent } from "../../../../dashboard/component/user/markdown-description/markdown-description.component";

/**
 * Read-only detail / preview page for a PUBLIC macro in the Hub "Macros" tab —
 * the macro analogue of {@link HubWorkflowDetailComponent}. It renders the macro
 * body in the SAME read-only JointJS canvas the workflow Hub uses, and offers
 * Clone (copy into your own Macros) and Generate (open the fill-parameters
 * page). Reached at /hub/macro/result/detail/:id.
 *
 * A macro body is stored WITHOUT operator positions, so we load it through
 * MacroService.macroDetailToWorkflow, which auto-lays-out the operators (and
 * keeps the MacroInput/MacroOutput boundary nodes) — that positioned content is
 * what reloadWorkflow needs to draw the canvas (raw public content has no
 * positions and renders empty).
 */
@UntilDestroy()
@Component({
  selector: "texera-macro-detail",
  templateUrl: "macro-detail.component.html",
  styleUrls: ["macro-detail.component.scss"],
  imports: [
    NgIf,
    NzButtonComponent,
    NzIconDirective,
    NzTooltipModule,
    WorkflowEditorComponent,
    MiniMapComponent,
    MarkdownDescriptionComponent,
  ],
})
export class MacroDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  wid: number | undefined;
  macroName = "";
  ownerName = "";
  macroDescription = "";
  private runnable = false;

  constructor(
    private workflowActionService: WorkflowActionService,
    private operatorMetadataService: OperatorMetadataService,
    private workflowPersistService: WorkflowPersistService,
    private macroService: MacroService,
    private route: ActivatedRoute,
    private router: Router,
    private notificationService: NotificationService
  ) {
    const routeId = this.route.snapshot.params.id;
    this.wid = isDefined(routeId) ? Number(routeId) : undefined;
    // Preview is read-only: no dragging / editing on the canvas.
    this.workflowActionService.disableWorkflowModification();
  }

  ngOnInit(): void {
    if (!isDefined(this.wid)) {
      return;
    }
    this.workflowPersistService
      .getOwnerName(this.wid)
      .pipe(untilDestroyed(this))
      .subscribe(ownerName => (this.ownerName = ownerName));
  }

  ngAfterViewInit(): void {
    if (!isDefined(this.wid)) {
      return;
    }
    // Operator schemas must be loaded before the editor can draw operator
    // boxes; in this standalone Hub route nothing else loads them.
    this.operatorMetadataService
      .getOperatorMetadata()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        if (!isDefined(this.wid)) {
          return;
        }
        this.macroService
          .getMacro(this.wid)
          .pipe(untilDestroyed(this))
          .subscribe({
            next: (detail: MacroDetail) => {
              this.macroName = detail.name ?? "";
              this.macroDescription = detail.description || "No description available";
              // Positioned + boundary-marker-inclusive body -> reloadWorkflow can
              // lay it out on the read-only canvas.
              const workflow = this.macroService.macroDetailToWorkflow(detail);
              // Same runnable gate the Macros list uses — decides which filter
              // tab a Clone should land on.
              const opTypes = (workflow.content?.operators ?? []).map(o => o.operatorType);
              this.runnable = this.macroService.isMacroRunnable(detail.portSpec?.inputs?.length ?? 0, opTypes);
              this.workflowActionService.reloadWorkflow(workflow);
              this.workflowActionService.getTexeraGraph().triggerCenterEvent();
            },
            error: () => this.notificationService.error(`Failed to load macro ${this.wid}`),
          });
      });
  }

  @HostListener("window:beforeunload")
  ngOnDestroy(): void {
    this.workflowActionService.clearWorkflow();
  }

  goBack(): void {
    this.router.navigateByUrl(HUB_MACRO_RESULT).catch(() => {
      this.notificationService.error("Go back failed. Please try again.");
    });
  }

  /** Clone this public macro into a new private macro the caller owns, then go
   * to Your Work > Macros so the copy is visible there. */
  onClone(): void {
    if (!isDefined(this.wid)) {
      return;
    }
    firstValueFrom(this.macroService.cloneMacro(this.wid))
      .then(() => {
        this.notificationService.success(`Cloned "${this.macroName}" to your Macros.`);
        // Land on the tab that shows the copy (not-runnable → All).
        this.router.navigate([USER_MACRO_OPEN], {
          queryParams: { filter: this.runnable ? "runnable" : "all" },
        });
      })
      .catch(() => this.notificationService.error("Failed to clone macro."));
  }

  /** Open the fill-parameters Generate page for this macro. */
  onGenerate(): void {
    if (!isDefined(this.wid)) {
      return;
    }
    this.router.navigate([USER_MACRO_OPEN, this.wid]);
  }
}
