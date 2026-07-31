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

import { Component, OnInit } from "@angular/core";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { ActivatedRoute, Router } from "@angular/router";
import { NgFor, NgIf } from "@angular/common";
import { firstValueFrom } from "rxjs";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzTooltipModule } from "ng-zorro-antd/tooltip";
import { WorkflowPersistService } from "../../../../common/service/workflow-persist/workflow-persist.service";
import { MacroService } from "../../../../workspace/service/macro/macro.service";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { Workflow } from "../../../../common/type/workflow";
import { isDefined } from "../../../../common/util/predicate";
import { HUB_MACRO_RESULT, USER_MACRO_OPEN } from "../../../../app-routing.constant";
import { MarkdownDescriptionComponent } from "../../../../dashboard/component/user/markdown-description/markdown-description.component";

/**
 * Read-only detail / preview page for a PUBLIC macro in the Hub "Macros" tab —
 * the macro analogue of {@link HubWorkflowDetailComponent}. It shows the macro's
 * identity, description, and a light operator-chain preview of its body, and
 * offers the two things a browsing user wants: Clone (take a private copy into
 * their own Macros) and Generate (open the fill-parameters page). Reached at
 * /hub/macro/result/detail/:id.
 *
 * The preview is a chip chain (not the JointJS canvas): a macro body carries
 * MacroInput/MacroOutput boundary nodes that the standalone editor can't draw
 * reliably here, so a chip chain is the robust way to show the structure.
 */
@UntilDestroy()
@Component({
  selector: "texera-macro-detail",
  templateUrl: "macro-detail.component.html",
  styleUrls: ["macro-detail.component.scss"],
  imports: [NgIf, NgFor, NzButtonComponent, NzIconDirective, NzTooltipModule, MarkdownDescriptionComponent],
})
export class MacroDetailComponent implements OnInit {
  wid: number | undefined;
  macroName = "";
  ownerName = "";
  macroDescription = "";
  operatorChain: string[] = [];
  inPorts = 0;
  outPorts = 0;

  constructor(
    private workflowPersistService: WorkflowPersistService,
    private macroService: MacroService,
    private route: ActivatedRoute,
    private router: Router,
    private notificationService: NotificationService
  ) {
    const routeId = this.route.snapshot.params.id;
    this.wid = isDefined(routeId) ? Number(routeId) : undefined;
  }

  ngOnInit(): void {
    if (!isDefined(this.wid)) {
      return;
    }
    this.workflowPersistService
      .getOwnerName(this.wid)
      .pipe(untilDestroyed(this))
      .subscribe(ownerName => (this.ownerName = ownerName));

    // A macro is a workflow row, so the public-read path returns its body.
    this.workflowPersistService
      .retrievePublicWorkflow(this.wid)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: (workflow: Workflow) => {
          this.macroName = workflow.name ?? "";
          this.macroDescription = workflow.description || "No description available";
          this.buildPreview(workflow);
        },
        error: () => this.notificationService.error(`Failed to load macro ${this.wid}`),
      });
  }

  /** Derive the operator-chain chips + port counts from the macro body. */
  private buildPreview(workflow: Workflow): void {
    const ops = (workflow.content?.operators ?? []).map(o => o.operatorType);
    this.inPorts = ops.filter(t => t === "MacroInput").length;
    this.outPorts = ops.filter(t => t === "MacroOutput").length;
    this.operatorChain = ops.filter(t => t !== "MacroInput" && t !== "MacroOutput");
  }

  goBack(): void {
    this.router.navigateByUrl(HUB_MACRO_RESULT).catch(() => {
      this.notificationService.error("Go back failed. Please try again.");
    });
  }

  /** Clone this public macro into a new private macro the caller owns. */
  onClone(): void {
    if (!isDefined(this.wid)) {
      return;
    }
    firstValueFrom(this.macroService.cloneMacro(this.wid))
      .then(() => {
        this.notificationService.success(`Cloned "${this.macroName}" to your Macros.`);
        this.router.navigate([USER_MACRO_OPEN]);
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
