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
import { WorkflowPersistService } from "../../../common/service/workflow-persist/workflow-persist.service";
import { NotificationService } from "../../../common/service/notification/notification.service";
import { UserService } from "../../../common/service/user/user.service";
import { DynamicSchemaService } from "../../service/dynamic-schema/dynamic-schema.service";
import { WorkflowCompilingService } from "../../service/compile-workflow/workflow-compiling.service";
import { ExecuteWorkflowService } from "../../service/execute-workflow/execute-workflow.service";
import { OperatorMetadataService } from "../../service/operator-metadata/operator-metadata.service";
import { ParameterizationService, ResolvedParameter } from "../../service/parameterization/parameterization.service";
import { WorkflowActionService } from "../../service/workflow-graph/model/workflow-action.service";
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
 * One input as it is actually rendered: the binding, plus the operator's own form field
 * for that property. Building the field from the operator's JSON schema -- rather than
 * guessing a control from the value -- is what makes a file property render the real
 * file picker, an attribute property a column dropdown, and so on. It is the same slice
 * the template and macro pages take.
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
 * The Parameterized Canvas: the second way to use a workflow.
 *
 * It shows the inputs an author chose to expose, a Run button, the workflow itself
 * (collapsed unless you go looking), and the results underneath. It is a view, not a
 * new kind of object -- it opens the same workflow the operator canvas opens, edits
 * the same operator properties, and runs the very same execution. Switching between
 * the two views changes what you see, never what you are working on.
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
  public brokenCount = 0;
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
  /**
   * Set when Run was pressed with no computing unit chosen. A hint after the fact, not a
   * condition checked beforehand: the run is always attempted, and every earlier attempt
   * to decide in advance whether it could succeed left the button dead with no recourse.
   * Clears itself the moment a unit appears.
   */
  public needsComputingUnit = false;

  /** The step whose property panel is open, if any. */
  public selectedOperatorId?: string;
  public selectedOperatorLabel = "";
  /**
   * The operator positions as they were stored. This page shows the workflow in a short
   * strip that starts out collapsed, and a canvas measured while hidden reports
   * meaningless geometry -- which autosave would then write back, flattening the
   * author's layout to the origin. Positions are therefore carried through saves
   * untouched: arranging the canvas belongs to the canvas.
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
    // Injected for its side effect too, and for the same reason. It compiles the
    // workflow in response to graph changes and writes the upstream column names into
    // each operator's dynamic schema -- that is what turns an attribute box into a
    // dropdown. Nothing else on this page injects it, so without this line it was never
    // constructed, never subscribed, never compiled, and every attribute on the form
    // fell back to a plain text input while the operator canvas showed a dropdown.
    private workflowCompilingService: WorkflowCompilingService,
    private computingUnitStatusService: ComputingUnitStatusService,
    private workflowConsoleService: WorkflowConsoleService,
    private workflowWebsocketService: WorkflowWebsocketService,
    private host: ElementRef<HTMLElement>,
    private datePipe: DatePipe,
    // The result table sizes its rows-per-page from this shared panel height. On the
    // operator canvas the docked panel drives it; this page has no such panel, so it was
    // left at the tiny default (300px) and every table showed a single row per page.
    private panelResizeService: PanelResizeService
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

    // An attribute box is a dropdown only once the workflow has been compiled and the
    // upstream column names written into the operator's dynamic schema. That answer
    // arrives over the network, well after these cards were built from the schema as it
    // stood at load, and nothing else rebuilds them -- so every attribute stayed a plain
    // text input while the operator canvas, which does watch this stream, showed a
    // dropdown of the same columns.
    this.dynamicSchemaService
      .getOperatorDynamicSchemaChangedStream()
      .pipe(debounceTime(FORM_DEBOUNCE_TIME_MS), untilDestroyed(this))
      .subscribe(({ operatorID }) => {
        // Rebuilding tears down the controls, so doing it under someone's cursor would
        // take the box they are typing in out from under them. Their own edit is what
        // triggered this, and the schema they need is already the one they can see.
        if (!this.rendersOperator(operatorID) || this.isTypingInTheForm()) {
          return;
        }
        this.readConfig();
      });

    // Whether a run is possible is read from a getter, so something has to tell this
    // view when the answer changes. A unit connects a moment after it is picked, and
    // without this Run stayed grey beside a selector already showing its green dot --
    // with nothing the reader could do about it.
    // markForCheck, not detectChanges: detectChanges runs a synchronous pass that an
    // unrelated component's NG0100 can throw out of, which would kill this subscription
    // and leave Run permanently grey again -- the very thing it is here to prevent.
    this.computingUnitStatusService
      .getSelectedComputingUnit()
      .pipe(untilDestroyed(this))
      .subscribe(unit => {
        if (unit) {
          this.needsComputingUnit = false;
        }
        this.cdr.markForCheck();
      });
    this.computingUnitStatusService
      .getStatus()
      .pipe(untilDestroyed(this))
      .subscribe(() => this.cdr.markForCheck());

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
          this.selectedOperatorId = undefined;
          this.selectedOperatorLabel = "";
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
        // We deliberately do NOT re-fit the preview when a run starts. A run repaints the
        // operators (port counts appear, borders change) which grows their bounding boxes,
        // and a re-fit then zoomed the whole graph down -- so pressing Run made a large
        // workflow visibly shrink. The editor now keeps its own geometry correct via its
        // container ResizeObserver, so the run repaint no longer needs a viewport re-fit;
        // leaving the view where the reader put it is the right behaviour.
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
          // The form is only offered for workflows whose author turned it on. Reaching
          // this URL any other way lands on the operator canvas instead of an empty page.
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

  /** Re-read everything the view renders from the definition and the live graph. */
  /** Whether any card on this page shows a setting belonging to that operator. */
  private rendersOperator(operatorID: string): boolean {
    return this.parameters.some(p => p.binding.operatorID === operatorID);
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
    const config = this.parameterizationService.getConfig();
    this.parameters = this.parameterizationService.resolveParameters();
    this.brokenCount = this.parameters.filter(p => p.brokenReason).length;
    this.instructionTitle = config.instruction?.title ?? "";
    this.instructionBody = config.instruction?.body ?? "";
    this.shownResultIds = config.resultOperatorIds;
    // A sink writes its output elsewhere and never has a result to show, so leave it out
    // of the picker; every other operator can be offered.
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
   * Build the form from the operators' own JSON schemas.
   *
   * For each exposed property we take the operator's schema, convert the whole thing
   * with FormlyJsonschema, and keep the one field for that property. That is what gives
   * a file property the real file picker and an enum a dropdown -- the same slice the
   * template and macro pages take. The author's display name and help text are applied
   * on top as the field's label and description; they never change the control.
   *
   * Each input gets its own form keyed by the binding id, so two operators exposing a
   * property of the same name cannot collide.
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
    // What the operator's own schema calls this setting. It is the placeholder behind
    // the author's name box, so clearing the name shows what the reader falls back to.
    const schemaLabel = (source.props?.label as string) || binding.propertyKey;
    field.key = binding.id;
    field.props = {
      ...(field.props ?? {}),
      label: binding.displayName || binding.propertyKey,
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
        // Formly emits while it is building the control, before anyone has touched it,
        // and that emission carries the schema's own empty default. Writing it back put
        // the default onto the operator and silently undid whatever had been changed on
        // the operator canvas -- the two views edit one workflow, so that was real data
        // loss, not a display glitch. An edit is either a form the user has dirtied, or
        // a value that differs from what the operator holds without being emptier than
        // it (some controls set their value programmatically and never mark dirty).
        const next = model[binding.id];
        const current = this.parameterizationService.readValue(binding.operatorID, binding.propertyKey);
        const isEmpty = (v: unknown) => v === undefined || v === null || v === "";
        const unchanged = JSON.stringify(next ?? null) === JSON.stringify(current ?? null);
        if (unchanged || (!form.dirty && isEmpty(next) && !isEmpty(current))) {
          return;
        }
        // Writing straight onto the operator is the same edit the operator canvas makes,
        // which is why the workflow below reflects it immediately.
        this.parameterizationService.writeValue(binding, next);
        this.parameters = this.parameterizationService.resolveParameters();
        // Refresh this card's snapshot too. It is what the template reads, so leaving it
        // stale meant a changed value still looked untouched -- and Reset never appeared.
        const refreshed = this.parameters.find(p => p.binding.id === binding.id);
        const card = this.rendered.find(r => r.parameter.binding.id === binding.id);
        if (refreshed && card) {
          card.parameter = refreshed;
        }
        this.cdr.detectChanges();
      });

    this.applyFieldOverrides(field, binding, schemaLabel);
    return { parameter, fields: [field], form, model };
  }

  /**
   * Rename and hide individual fields inside one input, as the author decided.
   *
   * A property is rarely one box: an array of objects puts several fields in front of
   * the reader, each labelled by whatever the operator's schema calls it -- `File Key`,
   * `Alias`. Those names describe the operator, not the question being asked of the
   * person filling the form, and some of them are not that person's business at all.
   *
   * Paths ignore array indices, so one decision covers every row of a repeated section.
   */
  /**
   * Path of a field within its property, with array indices dropped: a repeated section
   * gives every row the same field, so `pairs.value` is one decision, not one per row.
   */
  /**
   * The template for one row of a repeated section.
   *
   * formly lets `fieldArray` be either the template itself or a function that builds one
   * per row. Treating the function case as "no children" is why the fields inside an
   * array property could not be found at all: `pairs` looked like a leaf, so its `key`
   * and `value` never appeared in the author's list.
   */
  /** @internal exported for tests */
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
    if (!this.authoring && (!binding.fields || Object.keys(binding.fields).length === 0)) {
      return;
    }
    const walk = (node: FormlyFieldConfig, path: string): void => {
      // The input's own name is renamed the same way everything nested inside it is:
      // by clicking the title where it is written. It used to be a separate "Display
      // name" box in the card's footer, which meant one card taught two different ways
      // to do one thing. What it does not get is an eye -- a whole input leaves the form
      // through Remove, and a second control for that would be a second place to decide
      // it.
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
        // The editable label above is now the single title for this input. Clear formly's
        // own label so it is not rendered a second time next to it -- that duplicate is
        // what showed the title twice (most visibly on the array-typed FileParameter,
        // where the group label repeated the name).
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
          walk(row, path);
          return row;
        };
        return;
      }
      const arrayItem = ParameterizedCanvasComponent.arrayItemOf(node);
      const children = node.fieldGroup ?? arrayItem?.fieldGroup ?? [];
      for (const child of children) {
        walk(child, ParameterizedCanvasComponent.childPath(path, child.key));
      }
      if (arrayItem && !arrayItem.fieldGroup) {
        walk(arrayItem, path);
      }
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
   * How tall a chart renders, per result: 0 compact, 1 the default, 2 tall.
   *
   * A chart is the answer someone came for, and how much room it needs depends on the
   * chart -- a violin plot with fifty categories is unreadable at the height that suits
   * a single line. Kept per operator so setting one does not resize the others, and in
   * memory only: it is how this person wants to look at it now, not part of the workflow.
   */
  private zoomByResult = new Map<string, number>();

  /**
   * Bumped whenever a result changes, and used as the chart's *ngFor identity so the
   * frame is rebuilt rather than reused.
   *
   * The chart component reads its content once, when it is created. On this page it is
   * created as soon as the run starts -- before the engine has produced anything -- so
   * it rendered the word "undefined" and never looked again. Leaving the page and
   * coming back fixed it, which is the tell: the data was there all along, only nobody
   * asked for it a second time.
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
    // Growing the card is only half of it: a chart keeps whatever size it was drawn at
    // until something tells it to measure again, so zooming used to enlarge the frame
    // and leave the picture inside exactly as small as before. Let the new height land,
    // then ask the chart to redraw into it.
    this.cdr.detectChanges();
    this.later(() => this.fitVisualisations(), 60);
  }

  /**
   * Whether this operator's output is a table or a picture.
   *
   * Same rule the operator canvas uses: paginated results are tabular, anything else is
   * a visualisation. Rendering everything as a table meant chart operators such as
   * Image Visualizer produced a run but showed nothing.
   */
  /**
   * Make whatever a visualisation produced fit its card.
   *
   * These render inside an iframe, so the operator's HTML lays out at its natural size
   * and a picture ends up small in the middle of a large empty box. The document is
   * same-origin (srcdoc), so a stylesheet can be injected to scale the content down to
   * the card width, and a resize dispatched so chart libraries re-lay out. Nothing the
   * operator produced is altered -- only how it is sized for display.
   */
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

  public isTabularResult(operatorID: string): boolean {
    return this.workflowResultService.hasPaginatedResult(operatorID);
  }

  /**
   * Whether this step's visualisation actually drew something. A visualiser reserves a
   * fixed canvas even when its result is empty, so without this an empty chart showed as a
   * tall blank box; gating on real content lets the card collapse to the compact "No
   * result yet" line instead. Tables are excluded -- their own frame says "Empty result
   * set" and is handled by the tabular branch.
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
  // Filling in the form
  // ---------------------------------------------------------------------------

  /**
   * A filled-in value goes straight onto the operator, which is the same edit the
   * operator canvas would make -- so the workflow shown below updates as you type.
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

  // ---------------------------------------------------------------------------
  // Running. The same call the operator canvas makes, on the same workflow.
  // ---------------------------------------------------------------------------

  /**
   * Turn an engine error into something a reader can act on. Raw SQL / jOOQ / Java stack
   * traces mean nothing to a biologist, so those collapse to one plain sentence; a short
   * human message (e.g. "please select a .csv file") is kept, minus any Java class prefix.
   * The full text is always logged to the console for developers.
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

  public onRun(): void {
    if (this.isRunning) {
      this.executeWorkflowService.killWorkflow();
      return;
    }
    this.runError = "";
    // Same as the operator canvas: run the workflow as-is. We deliberately do NOT impose
    // a client-side "fill every field first" gate here -- it diverged from the canvas
    // (which lets you run), it mislabeled fields whose display name is empty ("Fill in
    // """), and it could not guarantee success anyway. Empty or invalid inputs now surface
    // as a real engine error through the execution-state stream (see the Failed handler),
    // while formly's own per-field "required" hint still guides the reader.
    this.executeWorkflowService.executeWorkflow(this.workflowName);
    // Said afterwards, so it never stands between the reader and the attempt.
    this.needsComputingUnit = this.computingUnitStatusService.getSelectedComputingUnitValue() == null;
  }

  // ---------------------------------------------------------------------------
  // Author mode
  // ---------------------------------------------------------------------------

  public toggleAuthoring(): void {
    this.authoring = !this.authoring;
    if (this.authoring) {
      // An author picks parameters off the workflow, so it has to be in front of them.
      this.showWorkflow();
    } else {
      // Back to the reader's view, which starts from the steps being out of the way.
      this.workflowOpen = false;
      this.workflowOpenTouched = false;
    }
    // Edit mode is what makes operator properties editable here; leaving it puts them
    // back to being shown rather than changed.
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

  /** Dismiss the panel: the selection is what holds it open. */
  public closeOperatorPanel(): void {
    this.workflowActionService
      .getJointGraphWrapper()
      .unhighlightOperators(...this.workflowActionService.getJointGraphWrapper().getCurrentHighlightedOperatorIDs());
    this.selectedOperatorId = undefined;
    this.selectedOperatorLabel = "";
    this.cdr.detectChanges();
  }

  /** Clicking a step opens the workflow's own property panel for it. */
  public onOperatorClicked(operatorID: string): void {
    const graph = this.workflowActionService.getTexeraGraph();
    if (!graph.hasOperator(operatorID)) {
      this.selectedOperatorId = undefined;
      this.selectedOperatorLabel = "";
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
   * Reveal the strip, then build the canvas inside it -- in that order, a frame apart.
   *
   * JointJS measures the paper once, when the editor is created, and never again on its
   * own. Uncollapsing the strip and creating the editor in the same change-detection
   * pass therefore races the browser's layout: win it and the paper measures its real
   * size, lose it and every element gets a zero-sized frame, so ports land on the
   * element origin and links route up and over the boxes instead of between them. That
   * is the drawing that appeared "sometimes" -- the two paths here even raced it
   * differently, since only one of them forced a synchronous pass.
   *
   * Waiting a frame makes the strip's real size a fact before anything measures it, and
   * the fit waits another frame so it runs against a canvas that exists.
   */
  private openWorkflowStrip(): void {
    // Build the editor a frame after the strip is shown (so it measures a real size), then
    // centre the graph -- the same lightweight approach the Hub's read-only preview uses.
    // The editor keeps its own paper sized/rebuilt via its container ResizeObserver, so no
    // extra re-fit / fade / observer machinery is needed here.
    this.later(() => {
      this.workflowEverOpened = true;
      this.cdr.detectChanges();
      this.later(() => this.workflowActionService.getTexeraGraph().triggerCenterEvent());
    });
  }

  /**
   * JointJS sizes its paper when the editor is created, and here that happens while the
   * section is still collapsed, so it measures zero and the workflow renders blank.
   * Nudge it once the section is actually on screen.
   */
  /**
   * Make the preview readable: size the paper now that it is on screen, then zoom and
   * pan so the whole workflow is in view.
   *
   * Deliberately a viewport change and nothing more. Re-arranging the operators would
   * mean that merely opening this page rewrote the positions the author chose on the
   * canvas -- and, with autosave on, saved them.
   */
  /**
   * Re-arrange the operators left to right.
   *
   * Author-only, because unlike zooming this rewrites the operators' positions -- it is
   * a real edit to the workflow, the same one the Auto-layout button makes on the
   * operator canvas. The new positions are adopted as the ones this page preserves on
   * save, otherwise the tidy-up would be undone the moment anything else is saved.
   */
  /**
   * Whether operator properties can be edited here.
   *
   * Only the two modes differ; the shape of the graph is off limits in both, which the
   * editor enforces through its own structureLocked input rather than through this
   * lock. Using the modification lock for that took the property panel down with it --
   * an author in edit mode could no longer change anything.
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
    const probe = document.createElement("span");
    probe.style.visibility = "hidden";
    probe.style.position = "absolute";
    probe.style.whiteSpace = "pre";
    probe.style.font = getComputedStyle(input).font;
    probe.textContent = input.value || input.placeholder;
    document.body.appendChild(probe);
    input.style.width = `${Math.min(probe.offsetWidth + 20, 800)}px`;
    document.body.removeChild(probe);
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
   * Switch to the operator canvas with a full page load, not a router navigation.
   *
   * The two views are separate pages that both drive the same singleton graph, shared
   * model and computing-unit connection. Handing over in-process leaves the next page
   * with the previous one's state -- the symptom was a canvas whose operators could no
   * longer be dragged, because the editor came up attached to a graph that was already
   * half torn down. A fresh document is the reliable handover, and this is the same
   * approach the codebase already takes when moving between workspace views.
   */
  /**
   * A full page load, deliberately.
   *
   * Routing between the two views is smoother, but these pages share root-level
   * services -- the graph, and the Yjs shared model behind it -- and leaving one does
   * not release its collaboration client. Routing therefore left the user present on
   * their own workflow twice: a ghost coeditor marker appeared on an operator, and the
   * duplicated session broke running. Reloading tears all of that down for certain.
   * Worth revisiting only once leaving a view provably releases the shared model.
   */
  public openRegularCanvas(): void {
    this.save();
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
   * Save the workflow this page opened, and only that one.
   *
   * The persist endpoint creates a workflow when the payload has no id, so saving
   * whatever the graph happens to hold would spawn stray "Untitled workflow" rows every
   * time this page is left before its workflow finished loading. Saving is therefore
   * conditional on the graph still holding the workflow we came here for.
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
   * Positions to write back: the stored one for each operator, falling back to whatever
   * the graph currently reports.
   *
   * Every operator must come out with a position. Loading a workflow throws outright on
   * an operator that has none, so writing a partial map would leave the workflow
   * unopenable in either view. An earlier version wrote the stored map wholesale, which
   * did exactly that whenever the graph held an operator the stored map predated.
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
   * Run something after the current frame, or after a delay, unless this page is gone
   * by then.
   *
   * Every one of these callbacks touches the view, and `detectChanges` on a destroyed
   * view throws. The window is not theoretical: leaving for the dashboard is an ordinary
   * in-app navigation, so a reader who clicks away during the few hundred milliseconds a
   * chart is waiting to be fitted would take the error.
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
   * Tear down exactly what the operator canvas tears down.
   *
   * Both views drive the same singleton services, so anything left bound here follows
   * the user to the next page. Skipping this was why the operator canvas came up frozen
   * after a visit: the previous shared model was still attached and kept putting
   * dragged operators back where they were.
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
