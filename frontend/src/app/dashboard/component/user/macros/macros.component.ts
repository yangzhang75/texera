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

import { Component, inject, OnInit } from "@angular/core";
import { DatePipe, NgFor, NgIf, NgStyle } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom, forkJoin } from "rxjs";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { OperatorMetadataService } from "../../../../workspace/service/operator-metadata/operator-metadata.service";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzTooltipModule } from "ng-zorro-antd/tooltip";
import { NzListModule } from "ng-zorro-antd/list";
import { NzAvatarModule } from "ng-zorro-antd/avatar";
import { NZ_MODAL_DATA, NzModalService } from "ng-zorro-antd/modal";
import { ShareAccessComponent } from "../share-access/share-access.component";
import { MacroService, MacroSummary } from "../../../../workspace/service/macro/macro.service";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { WorkflowPersistService } from "../../../../common/service/workflow-persist/workflow-persist.service";
import { USER_MACRO_OPEN, USER_WORKSPACE } from "../../../../app-routing.constant";

/**
 * The unified "Macros" dashboard tab. Lists every macro definition (kind=MACRO
 * workflow) the user can see. A macro is a reusable, encapsulated sub-workflow;
 * it can be inserted into a canvas as a node (LIVE), or generated into an
 * independent workflow (= the old "Template" flow). The runnable label shows
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
    NgStyle,
    DatePipe,
    FormsModule,
    NzButtonComponent,
    NzIconDirective,
    NzTooltipModule,
    NzListModule,
    NzAvatarModule,
  ],
})
export class MacrosComponent implements OnInit {
  macros: MacroSummary[] = [];
  isLoading = false;

  // View-only list controls (no server round-trip): name search + an
  // All / Runnable segmented filter. Pure client-side view of `macros`.
  // Defaults to "runnable": this page is biologist-facing and the runnable
  // macros are the ones they can Generate straight away; the "All" tab reveals
  // not-runnable ones too.
  searchText = "";
  filterMode: "all" | "runnable" = "runnable";

  constructor(
    private macroService: MacroService,
    private notificationService: NotificationService,
    private operatorMetadataService: OperatorMetadataService,
    private workflowPersistService: WorkflowPersistService,
    private modalService: NzModalService,
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
          // Newest first: the macro a user just created shows at the top. Sort by
          // last-modified time, tie-broken by wid (the backend returns no order).
          this.macros = [...macros].sort(
            (a, b) =>
              (this.epoch(b.lastModifiedTime) ?? 0) - (this.epoch(a.lastModifiedTime) ?? 0) || b.wid - a.wid
          );
          this.isLoading = false;
        },
        error: () => {
          this.isLoading = false;
          this.notificationService.error("Failed to load macros.");
        },
      });
  }

  /** Client-side view: name search + the All / Runnable filter. */
  get filteredMacros(): MacroSummary[] {
    const q = this.searchText.trim().toLowerCase();
    return this.macros.filter(m => {
      if (this.filterMode === "runnable" && !this.isRunnable(m)) return false;
      if (q && !(m.name ?? "").toLowerCase().includes(q)) return false;
      return true;
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
   * The muted description line under a macro name: op chain · op count, e.g.
   * "CSVFileScan → Projection → Filter · 5 ops". Mirrors the Workflows list's
   * description slot; the Created / Last-Modified times sit in their own right
   * column (metadata-container), exactly like the Workflows list.
   */
  metaLine(m: MacroSummary): string {
    const ops = this.bodyOps(m);
    if (ops.length === 0) return "Empty macro";
    return `${ops.join(" → ")} · ${ops.length} ${ops.length === 1 ? "op" : "ops"}`;
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

  /** Row tooltip: the default open depends on runnability (see onOpen). */
  runnableTooltip(m: MacroSummary): string {
    return this.isRunnable(m)
      ? "Opens in Generate workflow (the primary use case). Use Edit macro to change its body / configurable properties."
      : "Opens in Edit macro — not runnable on its own (no data source). You can still Generate it, but that produces an Invalid Workflow you complete by adding a source.";
  }

  /**
   * Default open (row click). Landing depends on runnability:
   * - runnable -> Generate workflow (the biologist's primary use case);
   * - not-runnable -> Edit macro (it's naturally still-to-edit/embed; sending it
   *   to Generate would only produce an Invalid Workflow -- a dead end).
   * Both explicit row actions remain available regardless, so anyone who wants
   * to Generate a not-runnable macro still can.
   */
  onOpen(m: MacroSummary): void {
    if (this.isRunnable(m)) {
      this.onGenerate(m);
    } else {
      this.onEditMacro(m);
    }
  }

  /** Row action "Generate workflow" -> the fill-parameters page (Template main page). */
  onGenerate(m: MacroSummary): void {
    this.router.navigate([USER_MACRO_OPEN, m.wid]);
  }

  /**
   * Row action "Edit macro" -> the editable canvas (drill-down editor route,
   * reused standalone with the macro as its own "parent"): edit the body, the
   * configurable-property whitelist, then Save. Available for every macro.
   */
  onEditMacro(m: MacroSummary): void {
    this.router.navigate([USER_WORKSPACE, m.wid, "macro", m.wid]);
  }

  /**
   * Row action "Share" — a macro is a `workflow` row (kind=MACRO), so it reuses
   * the exact ShareAccessComponent the Workflows list + workspace use.
   */
  async onShareMacro(m: MacroSummary): Promise<void> {
    this.modalService.create({
      nzContent: ShareAccessComponent,
      nzData: {
        writeAccess: !!m.isOwner,
        type: "workflow",
        id: m.wid,
        allOwners: await firstValueFrom(this.workflowPersistService.retrieveOwners()),
        inWorkspace: false,
      },
      nzFooter: null,
      nzTitle: "Share this macro with others",
      nzCentered: true,
      nzWidth: "800px",
    });
  }

  /** Row action "Change description" — edits the macro's description in place. */
  onChangeDescription(m: MacroSummary): void {
    let value = m.description ?? "";
    this.modalService.confirm({
      nzTitle: "Change description",
      nzContent: DescriptionEditComponent,
      nzData: { value },
      nzOnOk: (comp: DescriptionEditComponent) => {
        value = comp.value ?? "";
        firstValueFrom(this.workflowPersistService.updateWorkflowDescription(m.wid, value))
          .then(() => {
            m.description = value;
            this.notificationService.success("Description updated.");
          })
          .catch(() => this.notificationService.error("Failed to update description."));
      },
    });
  }

  /** Row action "Delete" — snapshot-only, so no LIVE references to worry about. */
  onDeleteMacro(m: MacroSummary): void {
    this.modalService.confirm({
      nzTitle: `Delete macro "${m.name}"?`,
      nzContent: "This removes the macro definition. Workflows already generated from it are unaffected.",
      nzOkText: "Delete",
      nzOkDanger: true,
      nzOnOk: () =>
        firstValueFrom(this.workflowPersistService.deleteWorkflow([m.wid]))
          .then(() => {
            this.macros = this.macros.filter(x => x.wid !== m.wid);
            this.notificationService.success("Macro deleted.");
          })
          .catch(() => this.notificationService.error("Failed to delete macro.")),
    });
  }
}

/**
 * Tiny inline editor mounted inside the "Change description" confirm modal — a
 * single textarea bound to `value`, read back by the modal's OK handler.
 */
@Component({
  selector: "texera-macro-description-edit",
  standalone: true,
  imports: [FormsModule],
  template: `<textarea
    class="tw-desc-edit"
    rows="4"
    style="width:100%"
    [(ngModel)]="value"
    placeholder="Macro description"></textarea>`,
})
export class DescriptionEditComponent {
  value = "";
  constructor() {
    const data = inject(NZ_MODAL_DATA) as { value?: string } | null;
    this.value = data?.value ?? "";
  }
}
