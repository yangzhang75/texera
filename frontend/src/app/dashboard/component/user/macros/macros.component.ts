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
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { MacroService, MacroSummary } from "../../../../workspace/service/macro/macro.service";
import { NotificationService } from "../../../../common/service/notification/notification.service";

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
  imports: [NgFor, NgIf],
})
export class MacrosComponent implements OnInit {
  macros: MacroSummary[] = [];
  isLoading = false;

  constructor(
    private macroService: MacroService,
    private notificationService: NotificationService
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.isLoading = true;
    this.macroService
      .listMacros()
      .pipe(untilDestroyed(this))
      .subscribe({
        next: macros => {
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

  /** Runnable == no unbound input ports (macro carries its own data source). */
  isRunnable(m: MacroSummary): boolean {
    return this.inCount(m) === 0;
  }

  /** T3: generate an independent workflow from this macro via MacroExpander. */
  onGenerate(m: MacroSummary): void {
    this.notificationService.info(`Generate workflow from "${m.name}" — wiring next (T3).`);
  }
}
