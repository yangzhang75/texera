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

import { Component, Input, OnInit } from "@angular/core";
import { NgFor, NgIf } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { forkJoin } from "rxjs";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { MacroService } from "../../service/macro/macro.service";
import { OperatorMetadataService } from "../../service/operator-metadata/operator-metadata.service";
import { NotificationService } from "../../../common/service/notification/notification.service";

/**
 * Edit-macro-side whitelist editor: the macro author checks which operator
 * properties are exposed as configurable in Template mode. Selections persist
 * to the macro definition's macro_metadata.param_spec (via MacroService); the
 * Generate page reads that whitelist and only renders those fields. Kept as a
 * small self-contained component so the Edit-macro canvas can drop it in
 * without touching WorkspaceComponent's internals.
 */
@UntilDestroy()
@Component({
  selector: "texera-macro-configurable-properties",
  standalone: true,
  imports: [NgFor, NgIf, FormsModule],
  template: `
    <div class="mcp-panel">
      <div class="mcp-header">Configurable properties</div>
      <div class="mcp-hint">
        Check which properties the workflow creator can fill in on the Generate page. Unchecked
        properties keep the macro's current values. Only simple scalar properties are offered.
      </div>
      <div *ngIf="loading" class="mcp-loading">Loading…</div>
      <div *ngIf="!loading && ops.length === 0" class="mcp-none">
        No configurable-eligible properties in this macro's operators.
      </div>
      <div *ngFor="let op of ops" class="mcp-op">
        <div class="mcp-op-label">{{ op.label }}</div>
        <span *ngIf="op.candidates.length === 0" class="mcp-op-empty">No simple configurable properties</span>
        <label *ngFor="let p of op.candidates" class="mcp-prop">
          <input type="checkbox" [checked]="isChecked(op.operatorID, p)" (change)="toggle(op.operatorID, p)" />
          <span>{{ p }}</span>
        </label>
      </div>
    </div>
  `,
  styles: [
    `
      .mcp-panel {
        padding: 10px 12px;
        max-height: 320px;
        overflow-y: auto;
      }
      .mcp-header {
        font-weight: 600;
        font-size: 14px;
        margin-bottom: 2px;
      }
      .mcp-hint {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.5);
        margin-bottom: 10px;
      }
      .mcp-loading,
      .mcp-none {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.45);
      }
      .mcp-op {
        padding: 6px 0;
        border-top: 1px solid #f0f0f0;
      }
      .mcp-op:first-of-type {
        border-top: none;
      }
      .mcp-op-label {
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 4px;
      }
      .mcp-op-empty {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.4);
        font-style: italic;
      }
      .mcp-prop {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin: 0 14px 4px 0;
        font-size: 13px;
        cursor: pointer;
      }
    `,
  ],
})
export class MacroConfigurablePropertiesComponent implements OnInit {
  @Input() macroId!: number;

  ops: { operatorID: string; label: string; candidates: string[] }[] = [];
  whitelist: Record<string, string[]> = {};
  loading = true;

  constructor(
    private macroService: MacroService,
    private operatorMetadataService: OperatorMetadataService,
    private notificationService: NotificationService
  ) {}

  ngOnInit(): void {
    forkJoin({
      detail: this.macroService.getMacro(this.macroId),
      _metadata: this.operatorMetadataService.getOperatorMetadata(),
    })
      .pipe(untilDestroyed(this))
      .subscribe({
        next: ({ detail }) => {
          const content = this.macroService.macroDetailToGeneratedContent(detail);
          const raw = detail.paramSpec;
          this.whitelist =
            raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string[]>) : {};
          // Show EVERY body operator (never drop one). Operators whose props are
          // all complex (e.g. Filter's `predicates` array) simply have no scalar
          // candidates and render a "no simple properties" note — they must not
          // silently disappear from the list.
          this.ops = content.operators.map(op => ({
            operatorID: op.operatorID,
            label: op.customDisplayName?.trim() ? op.customDisplayName : op.operatorType,
            candidates: this.macroService.configurableCandidates(op.operatorType),
          }));
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notificationService.error("Failed to load configurable properties.");
        },
      });
  }

  isChecked(operatorID: string, prop: string): boolean {
    return (this.whitelist[operatorID] ?? []).includes(prop);
  }

  toggle(operatorID: string, prop: string): void {
    const current = new Set(this.whitelist[operatorID] ?? []);
    if (current.has(prop)) {
      current.delete(prop);
    } else {
      current.add(prop);
    }
    const next: Record<string, string[]> = { ...this.whitelist };
    if (current.size === 0) {
      delete next[operatorID];
    } else {
      next[operatorID] = Array.from(current);
    }
    this.whitelist = next;
    this.macroService
      .updateMacroConfigurableProperties(this.macroId, this.whitelist)
      .pipe(untilDestroyed(this))
      .subscribe({ error: () => this.notificationService.error("Failed to save configurable properties.") });
  }
}
