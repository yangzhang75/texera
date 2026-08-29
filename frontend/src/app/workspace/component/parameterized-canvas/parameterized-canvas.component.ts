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
import { CdkDragDrop, DragDropModule } from "@angular/cdk/drag-drop";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { NzIconModule } from "ng-zorro-antd/icon";
import { NzButtonModule } from "ng-zorro-antd/button";
import { NzTooltipModule } from "ng-zorro-antd/tooltip";
import { NzAvatarModule } from "ng-zorro-antd/avatar";
import { UserIconComponent } from "../../../dashboard/component/user/user-icon/user-icon.component";
import { cloneDeep } from "lodash-es";
import { MarkdownService } from "ngx-markdown";
import { EMPTY, forkJoin, Subject, timer } from "rxjs";
import { debounceTime, switchMap, takeUntil, tap } from "rxjs/operators";

import { USER_WORKFLOW, USER_WORKSPACE } from "../../../app-routing.constant";
import { EditableLabelWrapperComponent } from "../../../common/formly/editable-label-wrapper/editable-label-wrapper.component";
import { ParameterBinding, Workflow, WorkflowContent } from "../../../common/type/workflow";
import { ComputingUnitStatusService } from "../../../common/service/computing-unit/computing-unit-status/computing-unit-status.service";
import { ComputingUnitState } from "../../../common/type/computing-unit-connection.interface";
import { WorkflowPersistService } from "../../../common/service/workflow-persist/workflow-persist.service";
import { NotificationService } from "../../../common/service/notification/notification.service";
import { UserService } from "../../../common/service/user/user.service";
import { DynamicSchemaService } from "../../service/dynamic-schema/dynamic-schema.service";
import { customFormlyFieldType, CANVAS_ONLY_FORMLY_TYPES } from "../../util/custom-formly-type";
import { WorkflowCompilingService } from "../../service/compile-workflow/workflow-compiling.service";
import { ExecuteWorkflowService } from "../../service/execute-workflow/execute-workflow.service";
import { OperatorMetadataService } from "../../service/operator-metadata/operator-metadata.service";
import { ParameterizationService, ResolvedParameter } from "../../service/parameterization/parameterization.service";
import { WorkflowActionService } from "../../service/workflow-graph/model/workflow-action.service";
import { ValidationWorkflowService } from "../../service/validation/validation-workflow.service";
import { isSink } from "../../service/workflow-graph/model/workflow-graph";
import { WorkflowConsoleService } from "../../service/workflow-console/workflow-console.service";
import { WorkflowResultService } from "../../service/workflow-result/workflow-result.service";
import { PanelResizeService } from "../../service/workflow-result/panel-resize/panel-resize.service";
import { WorkflowWebsocketService } from "../../service/workflow-websocket/workflow-websocket.service";
import { ExecutionState } from "../../types/execute-workflow.interface";
import { OperatorPredicate, Point } from "../../types/workflow-common.interface";
import { ComputingUnitSelectionComponent } from "../power-button/computing-unit-selection.component";
import { PropertyEditorComponent } from "../property-editor/property-editor.component";
import { ResultTableFrameComponent } from "../result-panel/result-table-frame/result-table-frame.component";
import { VisualizationFrameContentComponent } from "../visualization-panel-content/visualization-frame-content.component";
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

/** An operator offered in the "show its results" picker. */
interface ResultChoice {
  operatorID: string;
  label: string;
  shown: boolean;
}

/**
 * The Form View: a second way to use a workflow. Shows the inputs an author exposed, a Run
 * button, the (collapsed) workflow and its results. A view, not a new object -- it opens the
 * same workflow the canvas does, edits the same properties, runs the same execution.
 */
@UntilDestroy()
@Component({
  selector: "texera-parameterized-canvas",
  templateUrl: "./parameterized-canvas.component.html",
  styleUrls: ["./parameterized-canvas.component.scss"],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    FormlyModule,
    DragDropModule,
    NzIconModule,
    NzButtonModule,
    NzTooltipModule,
    NzAvatarModule,
    UserIconComponent,
    ComputingUnitSelectionComponent,
    WorkflowEditorComponent,
    MiniMapComponent,
    CoeditorUserIconComponent,
    ResultTableFrameComponent,
    VisualizationFrameContentComponent,
    PropertyEditorComponent,
  ],
})
export class ParameterizedCanvasComponent implements OnInit, OnDestroy {
  public wid?: number;
  /** "Saved at …", worded and formatted exactly as on the operator canvas. */
  public autoSaveState = "";
  public workflowName = "";
  public loading = true;
  /** Write access; only then may the author change what the form offers. */
  public canEdit = false;
  public authoring = false;

  public instructionOpen = true;
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
   * Milliseconds the current run has been going, counted from the same engine event the
   * operator canvas counts: the engine reports the real elapsed time, and a local 1s
   * timer fills in between reports so the display ticks instead of jumping.
   */
  public executionDuration = 0;
  public instructionTitle = "";
  public instructionBody = "";
  public instructionMode: "write" | "preview" = "write";
  public instructionPreviewHtml = "";
  public resultChoices: ResultChoice[] = [];
  public shownResultIds: string[] = [];

  public executionState: ExecutionState = ExecutionState.Uninitialized;
  public runError = "";

  /** The picked unit's connection state, mirrored from the same stream the operator
   *  canvas reads, so "Connecting" here means exactly what it means there. */
  public computingUnitStatus: ComputingUnitState = ComputingUnitState.NoComputingUnit;

  /** Workflow validity, read from the same validation stream the operator canvas uses,
   *  so Run is disabled ("Invalid Workflow" / "Empty Workflow") in the same cases. */
  public isWorkflowValid = true;
  public isWorkflowEmpty = false;

  /** The step whose property panel is open, if any. */
  public selectedOperatorId?: string;
  public selectedOperatorLabel = "";
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
    private markdownService: MarkdownService,
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
    private workflowWebsocketService: WorkflowWebsocketService,
    private host: ElementRef<HTMLElement>,
    private datePipe: DatePipe,
    // The result table sizes its rows-per-page from this shared panel height. On the
    // operator canvas the docked panel drives it; this page has no such panel, so it was
    // left at the tiny default (300px) and every table showed a single row per page.
    private panelResizeService: PanelResizeService,
    // Same source the operator canvas reads its "Invalid Workflow" / "Empty Workflow"
    // states from, so Run is disabled here exactly when it is disabled there.
    private validationWorkflowService: ValidationWorkflowService
  ) {}

  ngOnInit(): void {
    const wid = Number(this.route.snapshot.params.id);
    if (!Number.isFinite(wid)) {
      void this.router.navigate([USER_WORKFLOW]);
      return;
    }
    this.wid = wid;
    // Give the result tables a realistic height to page against, so they show a screenful
    // of rows instead of one. (~7 rows; the card scrolls for the rest.)
    this.panelResizeService.changePanelSize(900, 560);
    // Highlighting is off by default and is what turns a click on a step into a
    // selection, which is how an author picks the settings to expose.
    this.workflowActionService.setHighlightingEnabled(true);
    this.load(wid);

    // The run clock, reusing the operator canvas's source outright rather than timing
    // anything here: the engine is the only thing that knows when the run really began,
    // so a stopwatch started at the click would drift and would be wrong after a reload.
    this.workflowWebsocketService
      .subscribeToEvent("ExecutionDurationUpdateEvent")
      .pipe(
        tap(event => (this.executionDuration = event.duration)),
        switchMap(event => (event.isRunning ? timer(1000, 1000) : EMPTY)),
        untilDestroyed(this)
      )
      .subscribe(() => {
        this.executionDuration += 1000;
        this.cdr.markForCheck();
      });

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

    // The run button's state is read from getters, so a change in unit/connection/validity
    // has to repaint the view. markForCheck, not detectChanges: a synchronous pass can be
    // thrown out of by an unrelated component's NG0100, killing the subscription.
    this.computingUnitStatusService
      .getSelectedComputingUnit()
      .pipe(untilDestroyed(this))
      .subscribe(() => this.cdr.markForCheck());
    this.computingUnitStatusService
      .getStatus()
      .pipe(untilDestroyed(this))
      .subscribe(status => {
        this.computingUnitStatus = status;
        this.cdr.markForCheck();
      });
    this.workflowWebsocketService
      .getConnectionStatusStream()
      .pipe(untilDestroyed(this))
      .subscribe(() => this.cdr.markForCheck());
    // Validity from the canvas's own stream, so a broken graph disables Run ("Invalid") here
    // exactly as it does there.
    this.validationWorkflowService
      .getWorkflowValidationErrorStream()
      .pipe(untilDestroyed(this))
      .subscribe(value => {
        this.isWorkflowEmpty = value.workflowEmpty;
        this.isWorkflowValid = Object.keys(value.errors).length === 0;
        this.cdr.markForCheck();
      });

    // Selecting a step on the embedded canvas is how an author picks what to expose.
    // The canvas is read-only, but highlighting still works, so we reuse it rather
    // than teaching the editor a second click mode.
    this.workflowActionService
      .getJointGraphWrapper()
      .getJointOperatorHighlightStream()
      .pipe(untilDestroyed(this))
      .subscribe(ids => {
        if (ids.length === 1) {
          this.onOperatorClicked(ids[0]);
        }
        // The property panel announces "currently editing this operator" to everyone
        // sharing the workflow. That is right on the operator canvas; here it made this
        // page's own session show up as a coeditor -- the user's own name printed in
        // colour over an operator on the other view. Nobody is co-editing a graph from
        // a form, so this page stays silent on that channel.
        this.workflowActionService.getTexeraGraph().updateSharedModelAwareness("currentlyEditing", undefined);
      });

    // Clicking empty canvas clears the selection, and the panel should go with it.
    this.workflowActionService
      .getJointGraphWrapper()
      .getJointOperatorUnhighlightStream()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        if (this.workflowActionService.getJointGraphWrapper().getCurrentHighlightedOperatorIDs().length === 0) {
          this.clearSelection();
          this.cdr.detectChanges();
        }
      });

    // Ticking a property in the panel changes the definition; the list above has to
    // follow immediately, which is the whole point of editing them side by side.
    this.workflowActionService.parameterizationChanged$.pipe(untilDestroyed(this)).subscribe(() => {
      this.readConfig();
      this.cdr.detectChanges();
    });

    // Rebuild a chart when its result changes, so it shows what the run produced.
    this.workflowResultService
      .getResultUpdateStream()
      .pipe(untilDestroyed(this))
      .subscribe(update => {
        for (const operatorID of Object.keys(update ?? {})) {
          this.resultVersion.set(operatorID, (this.resultVersion.get(operatorID) ?? 0) + 1);
        }
        this.cdr.detectChanges();
        this.later(() => this.fitVisualisations(), 300);
      });

    this.executeWorkflowService
      .getExecutionStateStream()
      .pipe(untilDestroyed(this))
      .subscribe(({ current }) => {
        this.executionState = current.state;
        // Surface a failed run. Without this the spinner just stops, the results stay
        // empty, and the form gives zero feedback -- the opposite of what a reader needs.
        // onRun() clears runError before the next run, so a stale error never lingers.
        if (current.state === ExecutionState.Failed) {
          // A required input left empty is by far the commonest reason a run fails here,
          // and the engine reports it as an opaque "... is not contained in the schema".
          // Answer with the same words the field itself already shows ("required"), so the
          // two messages are consistent -- and it covers every operator, not just this one.
          this.runError = this.hasEmptyRequiredInputs()
            ? "Run failed: please fill in the required fields."
            : this.friendlyRunError(current.errorMessages?.[0]?.message?.trim() ?? "");
        }
        // Do NOT re-fit the preview when a run starts: the run repaints operators (growing
        // their boxes) and a re-fit then zoomed the whole graph down -- pressing Run made a
        // large workflow shrink. The editor keeps its own geometry via its ResizeObserver.
        if (this.hasResults) {
          this.later(() => this.fitVisualisations(), 400);
        }
        // Deliberately does not open the workflow. Someone using the form came for the
        // inputs and the results; the steps in between are optional and stay where the
        // reader left them.
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
          // The form is only offered for a workflow the author marked parameterized.
          // Reaching this URL any other way lands on the operator canvas, not an empty page.
          if (workflow.isParameterized !== true) {
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
          // The definition may have been authored elsewhere (or seeded), so make sure
          // the graph is actually set to materialise the results the form promises.
          this.parameterizationService.syncViewResultOperators();
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

  /**
   * Drop exposed inputs whose operator was deleted: they can never be filled, and a
   * re-added operator gets a fresh id so they could not reconnect. Guarded to edit mode
   * and after load, so a reader never mutates the workflow and a not-yet-seeded mid-load
   * graph never deletes a still-valid input. Only the operator-gone case, not a transiently
   * missing property schema.
   */
  private pruneBrokenBindings(): void {
    if (this.loading || !this.authoring) {
      return;
    }
    const graph = this.workflowActionService.getTexeraGraph();
    const params = this.parameterizationService.getConfig().parameters;
    const alive = params.filter(p => graph.hasOperator(p.operatorID));
    if (alive.length !== params.length) {
      this.parameterizationService.setParameters(alive);
    }
  }

  private readConfig(): void {
    this.pruneBrokenBindings();
    const config = this.parameterizationService.getConfig();
    this.parameters = this.parameterizationService.resolveParameters();
    this.instructionTitle = config.instruction?.title ?? "";
    this.instructionBody = config.instruction?.body ?? "";
    // Result cards only for operators that still exist: a deleted one lingers in the saved
    // config and rendered a stale card titled with its raw id. The picker is built from live
    // operators, so it un-checks itself.
    const graph = this.workflowActionService.getTexeraGraph();
    this.shownResultIds = config.resultOperatorIds.filter(id => graph.hasOperator(id));
    // A sink has no result to show, so leave it out of the picker.
    this.resultChoices = this.operators()
      .filter(op => !isSink(op))
      .map(op => ({
        operatorID: op.operatorID,
        label: this.parameterizationService.operatorLabel(op),
        shown: config.resultOperatorIds.includes(op.operatorID),
      }));
    // Readers always see rendered markdown; authors only while previewing.
    if (!this.authoring || this.instructionMode === "preview") {
      void this.renderInstruction();
    }
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
    if (parameter.brokenReason) {
      return { parameter, fields: [], form: new FormGroup({}), model: {} };
    }
    const schema = this.operatorSchemaFor(binding.operatorID);
    if (!schema) {
      return undefined;
    }
    const operatorType = this.workflowActionService.getTexeraGraph().getOperator(binding.operatorID)?.operatorType;
    const full = this.formlyJsonschema.toFieldConfig(cloneDeep(schema) as never, {
      map: (mapped, source) => {
        // Render the exact custom widget the operator property panel would (file/model/
        // dataset pickers, image/audio uploaders, ...), shared via customFormlyFieldType so
        // an exposed property shows its real control instead of degrading to a text box.
        const customType = customFormlyFieldType({
          key: mapped.key,
          operatorType,
          description: (source as { description?: string })?.description,
          currentType: mapped.type,
        });
        // Canvas-only widgets (code editor, drag-reorder) are not offered for exposure, but
        // an older workflow may already carry one -- leave it to formly's default control
        // (an editable field with its label) rather than a widget that cannot work here.
        if (customType && !CANVAS_ONLY_FORMLY_TYPES.has(customType)) {
          mapped.type = customType;
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
    if (this.canEdit) {
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
    } else {
      // A read-only viewer sees the author's values and can run with them, but cannot change
      // them: disable the control so it renders non-editable, and wire no write-back at all.
      form.disable();
    }

    this.applyFieldOverrides(field, binding, schemaLabel);
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

  private applyFieldOverrides(field: FormlyFieldConfig, binding: ParameterBinding, schemaLabel: string): void {
    const walk = (node: FormlyFieldConfig, path: string): void => {
      // Drop the operator schema's own per-field description on every field, nested ones
      // included. Those are the operator author's notes ("Attribute name in the schema",
      // "Renamed attribute name"); on this page the one piece of guidance is the help text
      // the form's author writes, rendered once by the card. Leaving the schema copies in
      // showed a second, unrelated line of helper text under half the inputs.
      node.props = { ...(node.props ?? {}), description: "" };
      // The input's name is renamed in place by clicking the title, like every nested
      // field. No eye here: a whole input leaves via Remove, not a hide toggle.
      if (!path && this.authoring) {
        EditableLabelWrapperComponent.decorate(
          node,
          {
            authoring: true,
            name: binding.displayName ?? "",
            hidden: false,
            fallback: schemaLabel,
            canHide: false,
          },
          name => this.onBindingNamed(binding.id, name),
          () => {}
        );
        // The editable label is now the single title; clear formly's own so it is not
        // rendered twice (the duplicate that showed array titles twice).
        node.props = { ...(node.props ?? {}), label: "" };
      }
      if (path) {
        const override = binding.fields?.[path] ?? {};
        if (override.displayName) {
          node.props = { ...(node.props ?? {}), label: override.displayName };
        }
        if (this.authoring) {
          // The author edits the label where it appears, and keeps hidden fields on
          // screen (faded) so they can be brought back.
          EditableLabelWrapperComponent.decorate(
            node,
            {
              authoring: true,
              name: override.displayName ?? "",
              hidden: override.hidden === true,
              fallback: (node.props?.label as string) || path,
            },
            name => this.onSubFieldNamed(binding.id, path, name),
            hidden => this.onSubFieldHiddenAt(binding.id, path, hidden)
          );
        } else if (override.hidden) {
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
            walk(child, ParameterizedCanvasComponent.childPath(path, child.key));
          }
          return row;
        };
        return;
      }
      const arrayItem = ParameterizedCanvasComponent.arrayItemOf(node);
      const children = node.fieldGroup ?? arrayItem?.fieldGroup ?? [];
      for (const child of children) {
        walk(child, ParameterizedCanvasComponent.childPath(path, child.key));
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

  private operators(): OperatorPredicate[] {
    return this.workflowActionService.getTexeraGraph().getAllOperators();
  }

  // ---------------------------------------------------------------------------
  // What each reader sees
  // ---------------------------------------------------------------------------

  /**
   * The author sees broken inputs so they can repair them; everyone else does not,
   * because filling one in could not affect the run.
   */
  public get visibleParameters(): ResolvedParameter[] {
    return this.authoring ? this.parameters : this.parameters.filter(p => !p.brokenReason);
  }

  public get hasInstruction(): boolean {
    return this.instructionBody.trim().length > 0;
  }

  public get isRunning(): boolean {
    return (
      this.executionState !== ExecutionState.Uninitialized &&
      this.executionState !== ExecutionState.Completed &&
      this.executionState !== ExecutionState.Failed &&
      this.executionState !== ExecutionState.Killed &&
      this.executionState !== ExecutionState.Terminated
    );
  }

  public get hasResults(): boolean {
    return this.shownResultIds.some(id => this.workflowResultService.hasAnyResult(id));
  }

  /**
   * The chosen steps that actually produced a result, so only those get a card. Whether a
   * Python UDF yields a result cannot be known from the graph -- some (e.g. a download/publish
   * step) never do -- so a chosen step earns its card at runtime rather than sitting on a
   * permanent "No result yet.".
   */
  public get resultIdsToShow(): string[] {
    return this.shownResultIds.filter(id => this.workflowResultService.hasAnyResult(id));
  }

  /** Chart height per result (0 compact / 1 default / 2 tall). Per operator so one does not
   *  resize the others, and in memory only -- a viewing preference, not part of the workflow. */
  private zoomByResult = new Map<string, number>();

  /**
   * Bumped when a result changes, used as the chart's *ngFor identity so the frame is
   * rebuilt, not reused: the chart reads its content once at creation (here, at run start,
   * before the engine has produced anything), so a stale frame showed "undefined" forever.
   */
  private resultVersion = new Map<string, number>();

  public trackByKey(_: number, key: string): string {
    return key;
  }

  public resultKey(operatorID: string): string {
    return operatorID + "#" + (this.resultVersion.get(operatorID) ?? 0);
  }

  public resultZoom(operatorID: string): number {
    return this.zoomByResult.get(operatorID) ?? 1;
  }

  public zoomResult(operatorID: string, delta: number): void {
    const next = Math.min(2, Math.max(0, this.resultZoom(operatorID) + delta));
    this.zoomByResult.set(operatorID, next);
    // Let the new card height land, then have the chart redraw into it -- growing the frame
    // alone leaves the picture at its old size until something asks it to re-measure.
    this.cdr.detectChanges();
    this.later(() => this.fitVisualisations(), 60);
  }

  /**
   * Scale each visualisation to its card. They render in a same-origin srcdoc iframe at
   * natural size, so we inject a stylesheet to fit the content to the card width and fire
   * a resize so chart libraries re-lay out. The operator's output is untouched.
   */
  /* v8 ignore start -- iframe/Plotly DOM fitting; no coverage in jsdom */
  private fitVisualisations(): void {
    const frames = this.host.nativeElement.querySelectorAll<HTMLIFrameElement>(".result-body iframe");
    frames.forEach(frame => {
      const apply = () => {
        try {
          const doc = frame.contentDocument;
          if (!doc?.body) {
            return;
          }
          // The style is injected once, but the resize below must fire every time --
          // returning early when it was already there is why making a chart bigger only
          // grew the frame around it: the chart never heard that it had more room.
          if (!doc.getElementById("pc-fit")) {
            const style = doc.createElement("style");
            style.id = "pc-fit";
            style.textContent = `
              html, body { margin: 0; padding: 8px; overflow-x: hidden; }
              /* Fill the frame rather than keeping the size it was first drawn at. */
              .js-plotly-plot, .plot-container, .plotly, .svg-container {
                width: 100% !important;
                height: 100% !important;
              }
              img, svg, canvas, video { max-width: 100% !important; height: auto !important; }
              table { max-width: 100%; }
            `;
            doc.head?.appendChild(style);
          }
          // A window resize event is not enough for Plotly: it writes its width and
          // height as inline styles when it first draws and only re-reads them when
          // asked directly. Without this the frame grew and the picture inside stayed
          // exactly the size it was born at.
          const win = frame.contentWindow as (Window & { Plotly?: any }) | null;
          const plots = doc.querySelectorAll<HTMLElement>(".js-plotly-plot");
          if (win?.Plotly?.Plots?.resize && plots.length) {
            plots.forEach(plot => {
              plot.style.width = "100%";
              plot.style.height = "100%";
              try {
                win.Plotly.Plots.resize(plot);
              } catch {
                // A chart mid-render cannot be resized; the next call will catch it.
              }
            });
          }
          win?.dispatchEvent(new Event("resize"));
        } catch {
          // A cross-origin document cannot be styled from here; leave it as it came.
        }
      };
      apply();
      frame.addEventListener("load", apply, { once: true });
    });
  }
  /* v8 ignore stop */

  public isTabularResult(operatorID: string): boolean {
    return this.workflowResultService.hasPaginatedResult(operatorID);
  }

  /**
   * Whether this step's visualisation drew something. A visualiser reserves a fixed canvas
   * even when empty, so gating on real content lets an empty result collapse to the compact
   * "No result yet" line instead of a tall blank box. Tables are excluded (tabular branch).
   */
  public vizHasContent(operatorID: string): boolean {
    if (this.isTabularResult(operatorID)) {
      return false;
    }
    const snapshot = this.workflowResultService.getResultService(operatorID)?.getCurrentResultSnapshot();
    return !!snapshot && snapshot.length > 0;
  }

  public resultLabel(operatorID: string): string {
    return this.resultChoices.find(c => c.operatorID === operatorID)?.label ?? operatorID;
  }

  public trackByRendered(_: number, rendered: RenderedParameter): string {
    return rendered.parameter.binding.id;
  }

  // ---------------------------------------------------------------------------
  // Running. The same call the operator canvas makes, on the same workflow.
  // ---------------------------------------------------------------------------

  /**
   * Turn an engine error into something a reader can act on: raw SQL/jOOQ/Java traces
   * collapse to one plain sentence, a short human message is kept (minus any Java prefix).
   * The full text is always logged for developers.
   */
  private friendlyRunError(raw: string): string {
    if (raw) {
      // eslint-disable-next-line no-console
      console.error("[parameterized-canvas] run failed:", raw);
    }
    const opaque =
      !raw || /\bSQL \[|org\.jooq|org\.apache|org\.postgresql|foreign key|constraint|jdbc|\bat [\w.$]+\(/i.test(raw);
    if (opaque) {
      return "Run failed — please reload and try again.";
    }
    const cleaned = raw
      .replace(/^[\w.$]+(?:Exception|Error):\s*/, "")
      .replace(/^requirement failed:\s*/i, "")
      .trim();
    return `Run failed: ${cleaned || "please check your inputs and try again."}`;
  }

  /**
   * Whether any exposed input that is required is still empty. Reuses formly's own
   * per-field required validation -- the very thing that renders "This field is required"
   * under the box -- so the run-failure message stays consistent with the field hint.
   */
  private hasEmptyRequiredInputs(): boolean {
    return this.rendered.some(r => r.form.invalid);
  }

  /**
   * A unit is picked but its socket is still coming up -- the same window the operator
   * canvas shows "Connecting" and disables its run button. Read from the exact condition
   * the canvas uses (menu.component's getRunButtonBehavior), so the two stay in step.
   */
  public get isConnecting(): boolean {
    return (
      this.computingUnitStatus !== ComputingUnitState.NoComputingUnit && !this.workflowWebsocketService.isConnected
    );
  }

  /** No unit chosen yet: the button offers "Connect" instead of "Run", exactly as the
   *  operator canvas does. */
  public get hasNoComputingUnit(): boolean {
    return this.computingUnitStatus === ComputingUnitState.NoComputingUnit;
  }

  /**
   * The Run button's label/icon/disabled, in the canvas's own precedence (menu.component's
   * getRunButtonBehavior): invalid/empty workflow, connecting, or no unit each disable it
   * and say why; otherwise Stop while running, Run when ready. Same order as the canvas.
   */
  public get runButtonState(): { label: string; icon: string; disabled: boolean } {
    if (this.isRunning) {
      return { label: "Stop", icon: "stop", disabled: false };
    }
    if (!this.isWorkflowValid) {
      return { label: "Invalid", icon: "warning", disabled: true };
    }
    if (this.isWorkflowEmpty) {
      return { label: "Empty", icon: "info-circle", disabled: true };
    }
    if (this.isConnecting) {
      return { label: "Connecting", icon: "loading", disabled: true };
    }
    if (this.hasNoComputingUnit) {
      return { label: "Connect", icon: "plus-circle", disabled: true };
    }
    return { label: "Run", icon: "caret-right", disabled: false };
  }

  public onRun(): void {
    if (this.isRunning) {
      this.executeWorkflowService.killWorkflow();
      return;
    }
    // The button is disabled in exactly the states a run cannot start from (invalid/empty
    // workflow, connecting, or no unit), so a stray call here would be a silent no-op.
    if (this.runButtonState.disabled) {
      return;
    }
    this.runError = "";
    // Run as-is, like the canvas -- no client-side "fill everything first" gate (it diverged
    // from the canvas and could not guarantee success anyway). Empty/invalid inputs surface
    // as a real engine error via the execution-state stream (see the Failed handler).
    this.executeWorkflowService.executeWorkflow(this.workflowName);
  }

  // ---------------------------------------------------------------------------
  // Author mode
  // ---------------------------------------------------------------------------

  public toggleAuthoring(): void {
    this.authoring = !this.authoring;
    if (this.authoring) {
      // An author picks parameters off the workflow, so show it.
      this.showWorkflow();
    } else {
      this.workflowOpen = false;
      this.workflowOpenTouched = false;
    }
    // Edit mode is what makes operator properties editable here.
    this.applyEditability();
    this.readConfig();
  }

  /**
   * Only presentation is editable here. Which operator property an input drives is
   * decided by ticking it in the property panel, so there is nothing to type and no way
   * to point an input at a property that does not exist.
   */
  public onEditBinding(parameter: ResolvedParameter, field: "displayName" | "helpText", value: string): void {
    this.parameterizationService.updateBinding(parameter.binding.id, { [field]: value });
    this.readConfig();
  }

  public onRemoveBinding(parameter: ResolvedParameter): void {
    this.parameterizationService.removeBinding(parameter.binding.id);
    this.readConfig();
  }

  public onDrop(event: CdkDragDrop<unknown>): void {
    this.parameterizationService.reorder(event.previousIndex, event.currentIndex);
    this.readConfig();
  }

  public onInstructionChange(): void {
    this.parameterizationService.updateConfig({
      instruction: { title: this.instructionTitle, body: this.instructionBody },
    });
  }

  public setInstructionMode(mode: "write" | "preview"): void {
    this.instructionMode = mode;
    if (mode === "preview") {
      void this.renderInstruction();
    }
  }

  private async renderInstruction(): Promise<void> {
    this.instructionPreviewHtml = this.instructionBody.trim()
      ? await Promise.resolve(this.markdownService.parse(this.instructionBody))
      : "";
    this.cdr.detectChanges();
  }

  public onToggleResult(choice: ResultChoice): void {
    this.parameterizationService.toggleResultOperator(choice.operatorID);
    this.readConfig();
  }

  /** No operator selected: this is what closes the property panel. */
  private clearSelection(): void {
    this.selectedOperatorId = undefined;
    this.selectedOperatorLabel = "";
  }

  /** Dismiss the panel: the selection is what holds it open. */
  public closeOperatorPanel(): void {
    this.workflowActionService
      .getJointGraphWrapper()
      .unhighlightOperators(...this.workflowActionService.getJointGraphWrapper().getCurrentHighlightedOperatorIDs());
    this.clearSelection();
    this.cdr.detectChanges();
  }

  /** Clicking a step opens the workflow's own property panel for it. */
  public onOperatorClicked(operatorID: string): void {
    const graph = this.workflowActionService.getTexeraGraph();
    if (!graph.hasOperator(operatorID)) {
      this.clearSelection();
      return;
    }
    this.selectedOperatorId = operatorID;
    this.selectedOperatorLabel = this.parameterizationService.operatorLabel(graph.getOperator(operatorID));
    this.cdr.detectChanges();
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  public toggleInstruction(): void {
    this.instructionOpen = !this.instructionOpen;
  }

  public toggleWorkflow(): void {
    this.workflowOpen = !this.workflowOpen;
    this.workflowOpenTouched = true;
    if (this.workflowOpen) {
      this.openWorkflowStrip();
    }
  }

  private showWorkflow(): void {
    if (!this.workflowOpen) {
      this.workflowOpen = true;
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

  /** Renaming the input itself, from its own title. */
  private onBindingNamed(bindingId: string, value: string): void {
    this.parameterizationService.updateBinding(bindingId, { displayName: value });
    this.readConfig();
  }

  private onSubFieldNamed(bindingId: string, path: string, value: string): void {
    this.parameterizationService.setFieldOverride(bindingId, path, { displayName: value });
    this.readConfig();
  }

  private onSubFieldHiddenAt(bindingId: string, path: string, hidden: boolean): void {
    this.parameterizationService.setFieldOverride(bindingId, path, { hidden });
    this.readConfig();
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
    // A read-only viewer can open and run the form (execution is gated on computing-unit
    // access, not workflow access) but must never persist: every such save is a guaranteed
    // 403 that would spam "Could not save" on each debounce. The inputs are non-editable
    // for them, so there is nothing to store anyway.
    if (!this.canEdit) {
      return;
    }
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
   * A filled-in value goes straight onto the operator, the same edit the operator canvas
   * would make. Kept from the parameterized-canvas so operators that write their value
   * outside formly's typed controls still coerce it.
   */
  public onValueChange(parameter: ResolvedParameter, raw: string): void {
    this.parameterizationService.writeValue(parameter.binding, this.coerce(parameter, raw));
    this.parameters = this.parameterizationService.resolveParameters();
  }

  /** Keep numbers numbers, so an operator that expects one does not receive "1500". */
  private coerce(parameter: ResolvedParameter, raw: string): unknown {
    if (parameter.schema?.type !== "number" && parameter.schema?.type !== "integer") {
      return raw;
    }
    if (raw.trim() === "") {
      return undefined;
    }
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? raw : parsed;
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
