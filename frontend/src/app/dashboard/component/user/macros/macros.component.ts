/*
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
import { NgFor, NgIf } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { forkJoin } from "rxjs";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { OperatorMetadataService } from "../../../../workspace/service/operator-metadata/operator-metadata.service";
import { NzCardComponent } from "ng-zorro-antd/card";
import { NzRowDirective, NzColDirective } from "ng-zorro-antd/grid";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzTooltipModule } from "ng-zorro-antd/tooltip";
import { UserAvatarComponent } from "../user-avatar/user-avatar.component";
import { formatRelativeTime } from "src/app/common/util/format.util";
import { MacroService, MacroSummary } from "../../../../workspace/service/macro/macro.service";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import {
  DEFAULT_WORKFLOW_NAME,
  WorkflowPersistService,
} from "../../../../common/service/workflow-persist/workflow-persist.service";
import { USER_MACRO_OPEN } from "../../../../app-routing.constant";

/**
 * The unified "Macros" dashboard tab. Lists every macro definition (kind=MACRO
 * workflow) the user can see. A macro is a reusable, encapsulated sub-workflow;
 * it can be inserted into a canvas as a node (LIVE), or generated into an
 * independent workflow (= the old "Template" flow). The runnable light shows
 * whether a macro can run standalone: runnable == no unbound input ports
 * (it carries its own data source). Not-runnable macros can still be generated
 * — they produce an Invalid Workflow the user completes by adding a source.
 */
@UntilDestroy()
@Component({
  selector: "texera-macros",
  templateUrl: "./macros.component.html",
  styleUrls: ["./macros.component.scss"],
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    FormsModule,
    NzCardComponent,
    NzRowDirective,
    NzColDirective,
    NzButtonComponent,
    NzIconDirective,
    NzTooltipModule,
    UserAvatarComponent,
  ],
})
export class MacrosComponent implements OnInit {
  macros: MacroSummary[] = [];
  isLoading = false;

  // Shared relative-time formatter (same one the Workflows list uses) so the
  // Created/Edited columns read identically across both pages.
  readonly formatRelativeTime = formatRelativeTime;

  // wid currently being renamed / re-described inline (undefined = none). Same
  // inline-edit affordance as the Workflows list.
  editingNameWid?: number;
  editingDescriptionWid?: number;

  constructor(
    private macroService: MacroService,
    private notificationService: NotificationService,
    private workflowPersistService: WorkflowPersistService,
    private operatorMetadataService: OperatorMetadataService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.isLoading = true;
    // Load operator metadata alongside the macro list: isRunnable() needs the
    // operator schemas (input-port counts) to detect body source operators.
    forkJoin({
      macros: this.macroService.listMacros(),
      _metadata: this.operatorMetadataService.getOperatorMetadata(),
    })
      .pipe(untilDestroyed(this))
      .subscribe({
        next: ({ macros }) => {
          this.macros = macros;
          this.isLoading = false;
        },
        error: () => {
          this.isLoading = false;
          this.notificationService.error("Failed to load macros.");
        },
      });
  }

  inCount(m: MacroSummary): number {
    return m.portSpec?.inputs?.length ?? 0;
  }

  outCount(m: MacroSummary): number {
    return m.portSpec?.outputs?.length ?? 0;
  }

  /** Coerce the transport time (epoch ms number, or ISO string) to epoch ms. */
  epoch(t: string | number | undefined): number | undefined {
    if (t === undefined || t === null) return undefined;
    return typeof t === "number" ? t : new Date(t).getTime();
  }

  /** Body operator types minus the boundary markers. */
  private bodyOps(m: MacroSummary): string[] {
    return (m.bodyOperatorTypes ?? []).filter(t => t !== "MacroInput" && t !== "MacroOutput");
  }

  /**
   * One-line subtitle for a macro row: the author's description if set, else a
   * composed op-chain like "Filter → Limit (2 ops, 1 in / 1 out)".
   */
  descriptionOrSubtitle(m: MacroSummary): string {
    const desc = m.description?.trim();
    if (desc) return desc;
    const ops = this.bodyOps(m);
    if (ops.length === 0) return "";
    const chain = ops.join(" → ");
    return `${chain} (${ops.length} ops, ${this.inCount(m)} in / ${this.outCount(m)} out)`;
  }

  /**
   * Runnable == carries its own data: no unbound external inputs AND a body
   * source operator. This is the gate for "can Generate" (not just a light).
   * Delegates to the shared MacroService helper so the Macros list and the
   * Generate page agree on one criterion.
   */
  isRunnable(m: MacroSummary): boolean {
    return this.macroService.isMacroRunnable(this.inCount(m), m.bodyOperatorTypes ?? []);
  }

  /** Row tooltip: every macro opens (Edit macro); only runnable ones can also generate. */
  runnableTooltip(m: MacroSummary): string {
    return this.isRunnable(m)
      ? "Open — edit the macro, or generate a workflow from it"
      : "Open — edit the macro. Not runnable on its own (no data source), so it can't be generated into a workflow yet.";
  }

  /**
   * Open the dual-mode macro page (Edit macro by default; Generate workflow is
   * a toggle inside, gated on runnable). Every macro can be opened -- the
   * runnable gate lives on the toggle, not on the row (Phase 2 D3 relocation).
   */
  onOpen(m: MacroSummary): void {
    // Don't navigate while an inline edit is in progress on this row (the input
    // click bubbles to the row).
    if (this.editingNameWid === m.wid || this.editingDescriptionWid === m.wid) {
      return;
    }
    this.router.navigate([USER_MACRO_OPEN, m.wid]);
  }

  /**
   * Inline rename. A macro is a kind=MACRO workflow row, so the existing
   * workflow name/description update endpoints apply unchanged -- reused here
   * to keep the Macros list behaving exactly like the Workflows list.
   */
  confirmRename(m: MacroSummary, name: string): void {
    const next = name.trim() || DEFAULT_WORKFLOW_NAME;
    this.workflowPersistService
      .updateWorkflowName(m.wid, next)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => (m.name = next),
        error: () => this.notificationService.error("Failed to rename macro."),
      })
      .add(() => (this.editingNameWid = undefined));
  }

  confirmDescription(m: MacroSummary, description: string): void {
    this.workflowPersistService
      .updateWorkflowDescription(m.wid, description)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => (m.description = description),
        error: () => this.notificationService.error("Failed to update description."),
      })
      .add(() => (this.editingDescriptionWid = undefined));
  }
}
