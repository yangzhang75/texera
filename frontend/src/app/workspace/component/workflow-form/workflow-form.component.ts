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

import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit } from "@angular/core";
import { CommonModule, DatePipe } from "@angular/common";
import { FormGroup, FormsModule, ReactiveFormsModule } from "@angular/forms";
import { FormlyFieldConfig, FormlyModule } from "@ngx-formly/core";
import { FormlyJsonschema } from "@ngx-formly/core/json-schema";
import { ActivatedRoute, Router } from "@angular/router";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { NzIconModule } from "ng-zorro-antd/icon";
import { NzAvatarModule } from "ng-zorro-antd/avatar";
import { UserIconComponent } from "../../../dashboard/component/user/user-icon/user-icon.component";
import { cloneDeep } from "lodash-es";
import { forkJoin, Subject } from "rxjs";
import { debounceTime, takeUntil } from "rxjs/operators";

import { USER_WORKFLOW, USER_WORKSPACE } from "../../../app-routing.constant";
import { ParameterBinding, Workflow, WorkflowContent } from "../../../common/type/workflow";
import { ComputingUnitStatusService } from "../../../common/service/computing-unit/computing-unit-status/computing-unit-status.service";
import { WorkflowPersistService } from "../../../common/service/workflow-persist/workflow-persist.service";
import { NotificationService } from "../../../common/service/notification/notification.service";
import { UserService } from "../../../common/service/user/user.service";
import { DynamicSchemaService } from "../../service/dynamic-schema/dynamic-schema.service";
import { WorkflowCompilingService } from "../../service/compile-workflow/workflow-compiling.service";
import { ExecuteWorkflowService } from "../../service/execute-workflow/execute-workflow.service";
import { OperatorMetadataService } from "../../service/operator-metadata/operator-metadata.service";
import { ParameterizationService, ResolvedParameter } from "../../service/parameterization/parameterization.service";
import { WorkflowActionService } from "../../service/workflow-graph/model/workflow-action.service";
import { GuiConfigService } from "../../../common/service/gui-config.service";
import { WorkflowConsoleService } from "../../service/workflow-console/workflow-console.service";
import { WorkflowResultService } from "../../service/workflow-result/workflow-result.service";
import { Point } from "../../types/workflow-common.interface";
import { WorkflowEditorComponent } from "../workflow-editor/workflow-editor.component";
import { MiniMapComponent } from "../workflow-editor/mini-map/mini-map.component";
import { CoeditorUserIconComponent } from "../menu/coeditor-user-icon/coeditor-user-icon.component";
import { CoeditorPresenceService } from "../../service/workflow-graph/model/coeditor-presence.service";
import { SAVE_DEBOUNCE_TIME_IN_MS } from "../workspace.component";
import { FORM_DEBOUNCE_TIME_MS } from "../../service/execute-workflow/execute-workflow.service";

/**
 * One rendered input: the binding plus the operator's own formly field for that property.
 * Building the field from the operator's JSON schema (not guessing from the value) is what
 * gives a file its picker and an attribute its column dropdown.
 */
interface RenderedParameter {
  parameter: ResolvedParameter;
  fields: FormlyFieldConfig[];
  form: FormGroup;
  model: Record<string, unknown>;
}

/**
 * The Form View: renders the inputs an author exposed and writes filled-in values back to
 * their operators. This PR adds the inputs on top of the page shell; the instruction panel,
 * running the workflow and showing results are added by the following PRs.
 */
@UntilDestroy()
@Component({
  selector: "texera-workflow-form",
  templateUrl: "./workflow-form.component.html",
  styleUrls: ["./workflow-form.component.scss"],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    FormlyModule,
    NzIconModule,
    NzAvatarModule,
    UserIconComponent,
    WorkflowEditorComponent,
    MiniMapComponent,
    CoeditorUserIconComponent,
  ],
})
export class WorkflowFormComponent implements OnInit, OnDestroy {
  public wid?: number;
  /** "Saved at …", worded and formatted exactly as on the operator canvas. */
  public autoSaveState = "";
  public workflowName = "";
  public loading = true;
  /** Write access; only then may the author change what the form offers. */
  public canEdit = false;
  public authoring = false;

  public workflowOpen = false;
  /** Set once the reader collapses or expands it themselves, so we stop deciding for them. */
  private workflowOpenTouched = false;
  /** The canvas is built the first time the strip opens, never while collapsed. */
  public workflowEverOpened = false;

  public parameters: ResolvedParameter[] = [];
  public rendered: RenderedParameter[] = [];
  /** Torn down and replaced whenever the form is rebuilt, so old fields stop writing. */
  private formsRebuilt = new Subject<void>();
  /** Set on teardown so deferred callbacks stop touching a view that is gone. */
  private destroyed = false;




  /**
   * Operator positions as stored. The workflow shows in a collapsible strip, and a canvas
   * measured while hidden reports junk geometry that autosave would flatten to the origin --
   * so positions are carried through saves untouched.
   */
  private storedPositions: { [operatorID: string]: Point } = {};

  constructor(
    // Public for the template: shows the same live collaborator avatars as the canvas.
    public coeditorPresenceService: CoeditorPresenceService,
    private route: ActivatedRoute,
    private router: Router,
    private workflowActionService: WorkflowActionService,
    private workflowPersistService: WorkflowPersistService,
    private operatorMetadataService: OperatorMetadataService,
    private parameterizationService: ParameterizationService,
    private executeWorkflowService: ExecuteWorkflowService,
    private workflowResultService: WorkflowResultService,
    private notificationService: NotificationService,
    private userService: UserService,
    private formlyJsonschema: FormlyJsonschema,
    private cdr: ChangeDetectorRef,
    // Injected for its side effect: it fills its map from the operator-add stream, so
    // it has to exist before the workflow loads or every operator arrives unregistered
    // and anything asking for a schema later throws.
    private dynamicSchemaService: DynamicSchemaService,
    // Injected for its side effect: it compiles on graph changes and writes column names
    // into each operator's dynamic schema (what turns an attribute box into a dropdown).
    // Nothing else on this page injects it, so without this line it never ran.
    private workflowCompilingService: WorkflowCompilingService,
    private computingUnitStatusService: ComputingUnitStatusService,
    private workflowConsoleService: WorkflowConsoleService,
    private host: ElementRef<HTMLElement>,
    private datePipe: DatePipe,
    private config: GuiConfigService
  ) {}

  ngOnInit(): void {
    const wid = Number(this.route.snapshot.params.id);
    if (!Number.isFinite(wid)) {
      void this.router.navigate([USER_WORKFLOW]);
      return;
    }
    this.wid = wid;
    this.load(wid);

    // Attribute boxes become dropdowns only after compilation writes the column enums into
    // each operator's dynamic schema -- which lands after these cards were built. Rebuild on
    // the compilation-state stream, a ReplaySubject(1) so a late subscriber (this page
    // reloads fresh on every Canvas<->Form switch) gets the current state at once; the
    // per-operator dynamic-schema stream is not replayed, so its emissions were missed.
    this.workflowCompilingService
      .getCompilationStateInfoChangedStream()
      .pipe(debounceTime(FORM_DEBOUNCE_TIME_MS), untilDestroyed(this))
      .subscribe(() => {
        if (this.isTypingInTheForm()) {
          return;
        }
        this.readConfig();
      });

    // Ticking a property in the panel changes the definition; the list above has to
    // follow immediately, which is the whole point of editing them side by side.
    this.workflowActionService.parameterizationChanged$.pipe(untilDestroyed(this)).subscribe(() => {
      this.readConfig();
      this.cdr.detectChanges();
    });
  }

  private load(wid: number): void {
    this.workflowActionService.resetAsNewWorkflow();
    forkJoin({
      metadata: this.operatorMetadataService.getOperatorMetadata(),
      workflow: this.workflowPersistService.retrieveWorkflow(wid),
    })
      .pipe(untilDestroyed(this))
      .subscribe({
        next: ({ workflow }) => {
          // The form is only offered where the feature flag is on and the author turned it on.
          // Reaching this URL any other way lands on the operator canvas, not an empty page.
          if (!this.config.env.formViewEnabled || workflow.isParameterized !== true) {
            void this.router.navigate([USER_WORKSPACE, String(wid)], { replaceUrl: true });
            return;
          }
          this.workflowName = workflow.name;
          this.storedPositions = { ...(workflow.content?.operatorPositions ?? {}) };
          this.canEdit = !workflow.readonly;
          this.workflowActionService.setNewSharedModel(wid, this.userService.getCurrentUser());
          this.workflowActionService.reloadWorkflow(workflow);
          // The workflow is shown, not edited, from here: dragging operators around or
          // deleting them belongs to the operator canvas.
          this.applyEditability();
          this.refreshSavedState();
          this.later(() => this.adjustWorkflowNameWidth(), 0);
          this.readConfig();
          this.registerAutoPersist();
          this.loading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.notificationService.error("You do not have access to this workflow.");
          void this.router.navigate([USER_WORKFLOW]);
        },
      });
  }

  /** Whether the cursor is currently inside one of this page's inputs. */
  private isTypingInTheForm(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !this.host.nativeElement.contains(active)) {
      return false;
    }
    return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName) || active.isContentEditable;
  }

  private readConfig(): void {
    this.parameters = this.parameterizationService.resolveParameters();
    this.buildForm();
  }

  /**
   * Build the form from the operators' JSON schemas (FormlyJsonschema), keeping the one
   * field per exposed property. Each input gets its own form keyed by binding id.
   */
  private buildForm(): void {
    this.formsRebuilt.next();
    this.rendered = this.visibleParameters
      .map(parameter => this.renderParameter(parameter))
      .filter((r): r is RenderedParameter => r !== undefined);
  }

  private renderParameter(parameter: ResolvedParameter): RenderedParameter | undefined {
    const { binding } = parameter;
    const schema = this.operatorSchemaFor(binding.operatorID);
    if (!schema) {
      return undefined;
    }
    const full = this.formlyJsonschema.toFieldConfig(cloneDeep(schema) as never, {
      map: mapped => {
        // The dataset file picker is registered under this formly type; the raw schema
        // only says "string", so without this a file input renders as a text box.
        if (mapped.key === "fileName") {
          mapped.type = "inputautocomplete";
        }
        return mapped;
      },
    });
    const source = (full.fieldGroup ?? []).find(child => child.key === binding.propertyKey);
    if (!source) {
      return undefined;
    }

    const field = cloneDeep(source);
    // The schema's own title ("Attributes", "Limit", "File") -- the reader's title when
    // unnamed, and the author's placeholder. Falls back to this, not the lower-camel key
    // ("fileName"), which would leave reader titles inconsistently cased.
    const schemaLabel = (source.props?.label as string) || binding.propertyKey;
    field.key = binding.id;
    field.props = {
      ...(field.props ?? {}),
      label: binding.displayName || schemaLabel,
      // Help text is rendered once by the card itself (.param-help-text in the reader,
      // the "Help text" box for the author). Do NOT also hand it to formly as the field
      // description, or scalar fields show it twice (formly's copy + the card's copy).
      description: "",
    };

    const form = new FormGroup({});
    const model: Record<string, unknown> = { [binding.id]: cloneDeep(parameter.value) };
    form.valueChanges
      .pipe(debounceTime(FORM_DEBOUNCE_TIME_MS), takeUntil(this.formsRebuilt), untilDestroyed(this))
      .subscribe(() => {
        // Formly emits the schema's empty default while building the control, before any
        // edit; writing that back silently wiped the operator's real value (both views edit
        // one workflow). So only accept a dirtied form, or a value that differs from the
        // operator's without being emptier (some controls set values without marking dirty).
        const next = model[binding.id];
        const current = this.parameterizationService.readValue(binding.operatorID, binding.propertyKey);
        const isEmpty = (v: unknown) => v === undefined || v === null || v === "";
        const unchanged = JSON.stringify(next ?? null) === JSON.stringify(current ?? null);
        if (unchanged || (!form.dirty && isEmpty(next) && !isEmpty(current))) {
          return;
        }
        // Write straight onto the operator (the same edit the canvas makes) and refresh this
        // card's snapshot, which the template reads.
        this.parameterizationService.writeValue(binding, next);
        this.parameters = this.parameterizationService.resolveParameters();
        const refreshed = this.parameters.find(p => p.binding.id === binding.id);
        const card = this.rendered.find(r => r.parameter.binding.id === binding.id);
        if (refreshed && card) {
          card.parameter = refreshed;
        }
        this.cdr.detectChanges();
      });

    this.applyFieldOverrides(field, binding);
    return { parameter, fields: [field], form, model };
  }

  /**
   * The template for one row of a repeated section. formly's `fieldArray` may be the
   * template or a function that builds one per row; resolve both so an array property's
   * sub-fields are reachable (treating the function case as a leaf hid them). @internal
   */
  public static arrayItemOf(node: FormlyFieldConfig): FormlyFieldConfig | undefined {
    const fa = node.fieldArray;
    if (!fa) {
      return undefined;
    }
    if (typeof fa !== "function") {
      return fa;
    }
    try {
      return fa(node);
    } catch {
      // A builder that needs more context than we can give it tells us nothing about
      // the row's shape; better to list no sub-fields than to guess at them.
      return undefined;
    }
  }

  /** @internal exported for tests */
  public static childPath(parent: string, key: unknown): string {
    if (typeof key !== "string" || key === "" || /^\d+$/.test(key)) {
      return parent;
    }
    return parent ? parent + "." + key : key;
  }

  private applyFieldOverrides(field: FormlyFieldConfig, binding: ParameterBinding): void {
    const walk = (node: FormlyFieldConfig, path: string): void => {
      // Drop the operator schema's own per-field description on every field, nested ones
      // included. Those are the operator author's notes ("Attribute name in the schema",
      // "Renamed attribute name"); on this page the one piece of guidance is the help text
      // the form's author writes, rendered once by the card. Leaving the schema copies in
      // showed a second, unrelated line of helper text under half the inputs.
      node.props = { ...(node.props ?? {}), description: "" };
      // Apply the author's stored overrides so a reader sees each field renamed and hidden
      // as set up. (Editing these in place is added by the authoring PR.)
      if (path) {
        const override = binding.fields?.[path] ?? {};
        if (override.displayName) {
          node.props = { ...(node.props ?? {}), label: override.displayName };
        }
        if (override.hidden) {
          node.hide = true;
        }
      }
      // A repeated section may build its row template on demand, once per row. Decorating
      // the object it returns is pointless -- the next row gets a fresh one. Wrap the
      // builder instead, so every row that formly ever creates comes out decorated.
      if (typeof node.fieldArray === "function") {
        const build = node.fieldArray;
        node.fieldArray = (f: FormlyFieldConfig) => {
          const row = build(f);
          // Walk what is INSIDE each row, never the row container itself. The container
          // carries the array property's own name, so decorating it as a root (path "")
          // printed the group title a second time above the rows -- the duplicate
          // "Attributes"/"Predicates" title. Its sub-fields keep their own key paths, the
          // same ones their overrides are stored under.
          for (const child of row.fieldGroup ?? []) {
            walk(child, WorkflowFormComponent.childPath(path, child.key));
          }
          return row;
        };
        return;
      }
      const arrayItem = WorkflowFormComponent.arrayItemOf(node);
      const children = node.fieldGroup ?? arrayItem?.fieldGroup ?? [];
      for (const child of children) {
        walk(child, WorkflowFormComponent.childPath(path, child.key));
      }
      /* v8 ignore start -- leaf array-item shape only formly produces at render */
      if (arrayItem && !arrayItem.fieldGroup) {
        walk(arrayItem, path);
      }
      /* v8 ignore stop */
    };
    walk(field, "");
  }

  private operatorSchemaFor(operatorID: string): object | undefined {
    const graph = this.workflowActionService.getTexeraGraph();
    if (!graph.hasOperator(operatorID)) {
      return undefined;
    }
    try {
      // Prefer the per-instance schema: it carries the upstream column names, so an
      // attribute picker renders as a dropdown of real columns rather than a text box.
      return this.dynamicSchemaService.getDynamicSchema(operatorID).jsonSchema;
    } catch {
      try {
        return this.operatorMetadataService.getOperatorSchema(graph.getOperator(operatorID).operatorType).jsonSchema;
      } catch {
        return undefined;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // What each reader sees
  // ---------------------------------------------------------------------------

  /**
   * The author sees broken inputs so they can repair them; everyone else does not,
   * because filling one in could not affect the run.
   */
  public get visibleParameters(): ResolvedParameter[] {
    return this.parameters.filter(p => !p.brokenReason);
  }



  /* v8 ignore stop */

  public trackByRendered(_: number, rendered: RenderedParameter): string {
    return rendered.parameter.binding.id;
  }

  // ---------------------------------------------------------------------------
  // Running. The same call the operator canvas makes, on the same workflow.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Author mode
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  public toggleWorkflow(): void {
    this.workflowOpen = !this.workflowOpen;
    this.workflowOpenTouched = true;
    if (this.workflowOpen) {
      this.openWorkflowStrip();
    }
  }

  /**
   * Reveal the strip, then build the canvas a frame later (so JointJS measures the strip's
   * real size, not a zero-sized frame that misroutes links), then centre the graph a frame
   * after that so the fit runs against a canvas that exists. The editor keeps its own paper
   * sized via its container ResizeObserver, so nothing more is needed here.
   */
  private openWorkflowStrip(): void {
    this.later(() => {
      this.workflowEverOpened = true;
      this.cdr.detectChanges();
      this.later(() => this.workflowActionService.getTexeraGraph().triggerCenterEvent());
    });
  }

  /**
   * Edit mode makes operator properties editable; the graph shape stays locked in both
   * modes (the editor enforces that via its own structureLocked, not this lock -- reusing
   * the modification lock for it also disabled the property panel).
   */
  private applyEditability(): void {
    if (this.authoring && this.canEdit) {
      this.workflowActionService.enableWorkflowModification();
    } else {
      this.workflowActionService.disableWorkflowModification();
    }
  }

  /**
   * Size the name field to its text, the way the operator canvas does, so what follows
   * it starts at the same place in both views instead of after a fixed-width box.
   */
  private adjustWorkflowNameWidth(): void {
    const input = this.host.nativeElement.querySelector<HTMLInputElement>("input.wf-name");
    if (!input) {
      return;
    }
    /* v8 ignore start -- font-metrics DOM measuring; jsdom has no layout */
    const probe = document.createElement("span");
    probe.style.visibility = "hidden";
    probe.style.position = "absolute";
    probe.style.whiteSpace = "pre";
    probe.style.font = getComputedStyle(input).font;
    probe.textContent = input.value || input.placeholder;
    document.body.appendChild(probe);
    input.style.width = `${Math.min(probe.offsetWidth + 20, 800)}px`;
    document.body.removeChild(probe);
    /* v8 ignore stop */
  }

  private refreshSavedState(): void {
    const lastModified = this.workflowActionService.getWorkflowMetadata()?.lastModifiedTime;
    this.autoSaveState =
      lastModified === undefined
        ? ""
        : "Saved at " +
          (this.datePipe.transform(
            lastModified,
            "MM/dd/yyyy HH:mm:ss",
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            "en"
          ) ?? "");
  }

  /** Renaming here is the same edit as renaming on the operator canvas. */
  public onRenameWorkflow(): void {
    this.workflowActionService.setWorkflowName(this.workflowName);
    this.workflowName = this.workflowActionService.getWorkflowMetadata().name;
    this.adjustWorkflowNameWidth();
    this.save();
  }

  /**
   * Switch to the operator canvas with a full page load, not a route. The two views share
   * root-level singletons (the graph, the Yjs shared model, the CU connection); handing
   * over in-process left the old state attached -- undraggable operators, a ghost coeditor
   * of yourself, broken runs. A fresh document is the reliable handover.
   */
  public openRegularCanvas(): void {
    this.save();
    /* v8 ignore next -- full-document navigation; jsdom cannot navigate */
    window.location.href = `${USER_WORKSPACE}/${this.wid}`;
  }

  /**
   * Save the same way the operator canvas does. Both views edit one workflow, so the
   * form has to write through the same debounced persist -- otherwise an author's
   * setup, or a value someone filled in, would be gone on the next visit.
   */
  private registerAutoPersist(): void {
    this.workflowActionService
      .workflowChanged()
      .pipe(debounceTime(SAVE_DEBOUNCE_TIME_IN_MS), untilDestroyed(this))
      .subscribe(() => this.save());
  }

  /**
   * Save the workflow this page opened, and only that one. The persist endpoint creates a
   * workflow when the payload has no id, so saving whatever the graph holds would spawn
   * stray "Untitled workflow" rows when the page is left before its workflow loaded.
   */
  private save(): void {
    if (!this.userService.isLogin() || !this.workflowPersistService.isWorkflowPersistEnabled()) {
      return;
    }
    const workflow = this.workflowActionService.getWorkflow();
    if (workflow.wid === undefined || workflow.wid !== this.wid) {
      return;
    }
    const preserved: Workflow = {
      ...workflow,
      content: { ...workflow.content, operatorPositions: this.positionsToSave(workflow.content) },
    };
    // On the way out the subscription must NOT be tied to this component: ngOnDestroy
    // calls save(), and untilDestroyed would tear the subscription down as part of the
    // very same destroy sequence, aborting the request that was the point of the call.
    const persist = this.workflowPersistService.persistWorkflow(preserved);
    (this.destroyed ? persist : persist.pipe(untilDestroyed(this))).subscribe({
      next: () => this.refreshSavedState(),
      // A save that fails silently is the worst thing this page can do: the author walks
      // away believing the form they just built is stored.
      error: () => this.notificationService.error("Could not save — your latest changes are not stored yet."),
    });
  }

  /**
   * A position for every operator (stored, else the graph's current, else origin). Loading
   * throws on an operator with no position, so a partial map would make the workflow
   * unopenable -- which is what writing the stored map wholesale did for any newer operator.
   */
  private positionsToSave(content: WorkflowContent): { [operatorID: string]: Point } {
    const positions: { [operatorID: string]: Point } = {};
    for (const operator of content.operators) {
      positions[operator.operatorID] = this.storedPositions[operator.operatorID] ??
        content.operatorPositions?.[operator.operatorID] ?? { x: 0, y: 0 };
    }
    return positions;
  }

  /**
   * Run after the current frame (or a delay), unless the page is gone by then: these
   * callbacks touch the view, and detectChanges on a destroyed view throws -- reachable by
   * navigating away while a chart is waiting to be fitted.
   */
  private later(fn: () => void, delayMs?: number): void {
    const run = () => {
      if (!this.destroyed) {
        fn();
      }
    };
    if (delayMs === undefined) {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, delayMs);
    }
  }

  /**
   * Tear down exactly what the operator canvas tears down: both views drive the same
   * singleton services, so anything left bound here follows the user to the next page
   * (the symptom was a frozen canvas after a visit -- the old shared model still attached).
   */
  @HostListener("window:beforeunload")
  ngOnDestroy(): void {
    this.destroyed = true;
    this.save();
    this.workflowActionService.clearWorkflow();
    this.computingUnitStatusService.disconnect();
    this.executeWorkflowService.resetExecutionAndWorkers();
    this.workflowConsoleService.clearConsoleMessages();
    this.workflowResultService.clearResults();
  }
}
