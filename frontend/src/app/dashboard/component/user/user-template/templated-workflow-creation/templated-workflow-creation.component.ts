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

import {FormlyFieldConfig, FormlyModule} from "@ngx-formly/core";
import {FormlyJsonschema} from "@ngx-formly/core/json-schema";
import {FormGroup, ReactiveFormsModule} from "@angular/forms";
import {AfterViewInit, Component, OnInit, ViewChild} from "@angular/core";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {NotificationService} from "../../../../../common/service/notification/notification.service";
import {UserService} from "../../../../../common/service/user/user.service";
import {WorkflowActionService} from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import {Workflow, WorkflowContent} from "../../../../../common/type/workflow";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {AppSettings} from "../../../../../common/app-setting";
import {HttpClient, HttpHeaders} from "@angular/common/http";
import {catchError, debounceTime, EMPTY, firstValueFrom, forkJoin, merge, Observable, of, Subscription} from "rxjs";
import {filter, finalize, map, switchMap} from "rxjs/operators";
import {cloneDeep, isEqual} from "lodash";
import {ActivatedRoute, Router} from "@angular/router";
import {MacroService} from "../../../../../workspace/service/macro/macro.service";
import {USER_WORKSPACE} from "../../../../../app-routing.constant";
import {TemplateService} from "../../../../service/user/template/template.service";
import {OperatorMetadataService} from "../../../../../workspace/service/operator-metadata/operator-metadata.service";
import {OperatorPredicate} from "../../../../../workspace/types/workflow-common.interface";
import {
  WORKFLOW_COMPILATION_ENDPOINT,
  WorkflowCompilingService,
} from "../../../../../workspace/service/compile-workflow/workflow-compiling.service";
import {DynamicSchemaService} from "../../../../../workspace/service/dynamic-schema/dynamic-schema.service";
import {OperatorSchema} from "../../../../../workspace/types/operator-schema.interface";
import {
  OperatorPortSchemaMap,
  WorkflowCompilationResponse,
} from "../../../../../workspace/types/workflow-compiling.interface";
import {TemplatedWorkflowDraftService} from "./service/templated-workflow-draft.service";
import {ExecuteWorkflowService} from "../../../../../workspace/service/execute-workflow/execute-workflow.service";
import {ExecutionState} from "../../../../../workspace/types/execute-workflow.interface";
import {CommonModule} from "@angular/common";
import {NzButtonModule} from "ng-zorro-antd/button";
import {NzIconModule} from "ng-zorro-antd/icon";
import {NzTooltipModule} from "ng-zorro-antd/tooltip";
import {WorkspaceComponent} from "../../../../../workspace/component/workspace.component";
import {TemplatedWorkflowService} from "../../../../service/user/templated-workflow/templated-workflow.service";
import {NzModalService} from "ng-zorro-antd/modal";
import {ShareAccessComponent} from "../../share-access/share-access.component";

interface ConfigurableSection {
  operatorID: string;
  label: string;
  fields: FormlyFieldConfig[];
  form: FormGroup;
  model: Record<string, any>;
  // Set on a drilled (nested-macro) section (P2.3): `path` is the leaf op's path
  // relative to this generation's root ("nestedNodeId/.../leafOpId") and keys the
  // override map injected at Create (P2.4); `depth` (1 = first nesting level) is
  // for display. Absent on root top-level sections.
  path?: string;
  depth?: number;
  // For a nested-macro param surfaced at the outermost level: the display name
  // of the containing nested macro (e.g. "limit_filter"), shown as a group tag
  // so the biologist knows which nested macro the field belongs to.
  groupLabel?: string;
}

// P2.3 — one entry per drilled level; the breadcrumb is [root, ...stack.labels].
interface DrillLevel {
  macroId: string;
  nodeId: string;
  label: string; // definition name + version, e.g. "limit_filter v22"
  path: string; // node path relative to the generation root
}

// A nested Macro node offered as a drill target at the current scope.
interface DrillRow {
  nodeId: string;
  macroId: string;
  label: string;
  path: string;
  cycle: boolean; // macro already on the current path (A→B→A) — drill disabled
}

@UntilDestroy()
@Component({
  templateUrl: "./templated-workflow-creation.component.html",
  styleUrls: ["./templated-workflow-creation.component.scss"],
  providers: [TemplatedWorkflowDraftService],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormlyModule,
    NzButtonModule,
    NzIconModule,
    NzTooltipModule,
    WorkspaceComponent,
  ],
})
export class TemplatedWorkflowCreationComponent implements OnInit, AfterViewInit {
  public tid: number | undefined;
  // When set, this page generates a workflow from a MACRO definition instead of
  // a template. Same preview + Formly form + submit UI; data source is the macro.
  public macroId: number | undefined;
  // Whether the current user owns the macro definition — gates the Share action
  // (only an owner can grant/revoke access), mirroring the workspace Share menu.
  public macroIsOwner = false;
  // When this Generate page was reached by drilling into a NESTED macro from an
  // outer macro's preview, `ret` is the outer page's full URL to return to. It
  // chains: the outer URL itself carries its own `ret`, so multi-level back works.
  public returnUrl: string | undefined;
  // Basic info for the workflow that "Create Workflow" will produce.
  public genName = "";
  public genDescription = "";
  // Runnable gate (D3): only a runnable macro can be generated. Create Workflow
  // is disabled with a reason when the macro can't run standalone.
  public macroRunnable = true;
  public wid: number | undefined;
  public template: WorkflowContent | undefined;

  public sections: ConfigurableSection[] = [];
  // P2.3 — focused-drill state. drillStack is empty at root; drillRows are the
  // nested Macro nodes offered at the current scope. paramOverrides holds edits
  // made at drilled levels (path -> {prop: value}), injected at Create (P2.4) —
  // it never touches the shared macro definition. macroContentCache/macroMeta
  // are filled by prefetchNestedMacros and CLEARED on each Generate entry so a
  // nested definition edited between visits is never served stale.
  public drillStack: DrillLevel[] = [];
  public drillRows: DrillRow[] = [];
  public paramOverrides: Record<string, Record<string, unknown>> = {};
  private macroContentCache = new Map<string, WorkflowContent>();
  // Same nested definitions as macroContentCache, but WITH the MacroInput/
  // MacroOutput boundary markers kept — used ONLY to render the drilled canvas,
  // so a biologist sees where data enters/leaves the nested macro (in/out). The
  // stripped macroContentCache still drives the param form + drill logic.
  private macroDisplayCache = new Map<string, WorkflowContent>();
  private macroMeta = new Map<string, { name: string; version: number }>();
  public rootLabel = "";
  // The root preview Workflow (expanded macro body shown at root scope). Kept so
  // the embedded canvas can be re-rendered to the current drill level's graph:
  // drilling reloads the nested macro's body, returning reloads this.
  private rootPreviewWorkflow?: Workflow;
  // The embedded preview workspace — used to trigger its in-place Run when the
  // biologist runs the whole workflow from a drilled nested scope.
  @ViewChild(WorkspaceComponent) private previewWorkspace?: WorkspaceComponent;
  // Raw compile output schemas. Besides normal ops, the compiler ALSO keys each
  // expanded inner op's RESOLVED INPUT schema by its full node path
  // ("nodeId/.../bodyOpId") — the drilled view uses those (direct lookup) to turn
  // nested attribute fields into column dropdowns at any depth. Captured per compile.
  private lastRawOutputSchemas: Record<string, OperatorPortSchemaMap> = {};
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;
  public executionState: ExecutionState = ExecutionState.Uninitialized;
  public ExecutionState = ExecutionState;

  // Recreated whenever sections are rebuilt because each rebuild creates new FormGroup instances.
  private formChangesSub: Subscription | undefined;
  private workflowReady: boolean = false;
  public showEmbeddedWorkspace = false;

  // The configurable-property values of the last successful Submit (null until the first Submit).
  // Submit is greyed only while the form still matches this snapshot, so: fresh open = bright,
  // just-submitted = grey (and clicking it does not create a duplicate), edited = bright again.
  private lastSubmittedPayload: Record<string, Record<string, unknown>> | null = null;

  // "Run produces a workflow": when the user runs the macro preview, we also
  // persist a real (listed) workflow from the current params. Reused across runs
  // with identical params (keyed by the generated-content signature) so repeated
  // runs don't pile up duplicates; a param change produces a new one. Reset per
  // Generate entry (initFromMacro).
  private runGeneratedWid?: number;
  private runGeneratedSignature?: string;
  private prevExecutionState?: ExecutionState;

  // Signature of the schemas the configurable sections were last built from. Used to skip
  // redundant rebuilds (which would otherwise destroy the field being edited and drop focus).
  private lastEnrichedSignature = "";

  constructor(
    private notificationService: NotificationService,
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private templateService: TemplateService,
    private templatedWorkflowService: TemplatedWorkflowService,
    private templatedWorkflowDraftService: TemplatedWorkflowDraftService,
    private executeWorkflowService: ExecuteWorkflowService,
    private workflowPersistService: WorkflowPersistService,
    private operatorMetadataService: OperatorMetadataService,
    private dynamicSchemaService: DynamicSchemaService,
    // injected to ensure the singleton WorkflowCompilingService is instantiated
    private workflowCompilingService: WorkflowCompilingService,
    private formlyJsonschema: FormlyJsonschema,
    private route: ActivatedRoute,
    private http: HttpClient,
    private macroService: MacroService,
    private modalService: NzModalService,
    private router: Router
  ) {
    this.userService
      .userChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        this.currentUid = this.userService.getCurrentUser()?.uid;
        this.isLogin = this.userService.isLogin();
      });

    this.executionState = this.executeWorkflowService.getExecutionState().state;
    this.executeWorkflowService
      .getExecutionStateStream()
      .pipe(untilDestroyed(this))
      .subscribe(event => {
        const state = event.current.state;
        // A run just STARTED (transitioned into a running state): persist a real
        // listed workflow from the current params so "Run produces a workflow".
        const running = state === ExecutionState.Initializing || state === ExecutionState.Running;
        const wasRunning =
          this.prevExecutionState === ExecutionState.Initializing ||
          this.prevExecutionState === ExecutionState.Running;
        if (running && !wasRunning) {
          this.ensureGeneratedWorkflowForRun();
        }
        this.prevExecutionState = state;
        this.executionState = state;
      });
  }

  /**
   * "Run produces a workflow": persist a real (listed) workflow from the current
   * params when the macro preview runs — but only create a NEW one when the
   * generated content actually changed. Repeated runs with the same params reuse
   * the one already created (no duplicate pile-up). Root scope + macro mode only;
   * fire-and-forget so it never blocks or affects the run itself.
   */
  private ensureGeneratedWorkflowForRun(): void {
    if (!this.macroId || this.drillStack.length > 0 || !this.template) {
      return;
    }
    const content = this.buildMacroContentWithParams();
    const signature = JSON.stringify(content);
    if (this.runGeneratedWid !== undefined && this.runGeneratedSignature === signature) {
      return; // unchanged since the last run -> reuse the existing workflow
    }
    const name = this.genName?.trim() || "Generated workflow";
    this.macroService
      .generateWorkflowFromMacro(this.macroId, content, name, false, this.genDescription?.trim() || undefined)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: wid => {
          this.runGeneratedWid = wid;
          this.runGeneratedSignature = signature;
          this.notificationService.success(`Workflow "${name}" saved to Your Work › Workflows.`);
        },
        error: () => {
          /* best-effort; the run itself is unaffected */
        },
      });
  }

  public get formValid(): boolean {
    return this.sections.every(s => s.form.valid);
  }

  public get isWorkflowExecutionActive(): boolean {
    return [
      ExecutionState.Initializing,
      ExecutionState.Running,
      ExecutionState.Pausing,
      ExecutionState.Paused,
      ExecutionState.Resuming,
      ExecutionState.Recovering,
    ].includes(this.executionState);
  }

  // Hard-disabled only while the workflow genuinely can't accept a submit (loading or running).
  public get submitDisabled(): boolean {
    return !this.workflowReady || this.isWorkflowExecutionActive;
  }

  // "Already submitted this exact state" state: the button looks grey once the current form matches
  // the last successful Submit, so a second click can't create a duplicate. It stays CLICKABLE on
  // purpose (only cursor: not-allowed styling) so a pending edit in an nz-input-number -- which
  // commits its value on blur -- still commits when the button is clicked; the click then finds the
  // change and creates. Fresh open (no Submit yet) and any edit are NOT idle -> the button is bright.
  public get submitIdle(): boolean {
    if (this.submitDisabled) {
      return false;
    }
    return this.lastSubmittedPayload !== null && !this.hasPendingChanges();
  }

  // Pending = the current form values differ from what was last submitted. Before the first Submit
  // (no snapshot) everything counts as pending, so the button is clickable on a freshly opened page.
  private hasPendingChanges(): boolean {
    if (this.lastSubmittedPayload === null) {
      return true;
    }
    return !isEqual(this.getConfigurablePropertyUpdatePayload().operatorProperties, this.lastSubmittedPayload);
  }

  public onJobFormSubmitted(): void {
    if (!this.workflowReady) {
      this.notificationService.warning("Workflow is still loading. Please try again after it finishes loading.");
      return;
    }

    if (this.isWorkflowExecutionActive) {
      this.notificationService.warning(
        "Cannot submit template properties while the workflow is running. Stop or wait for the workflow to finish before submitting changes."
      );
      return;
    }

    if (!this.formValid) {
      // Don't grey out the button -- surface what's missing instead: mark every control touched
      // so required-but-empty fields turn red, and tell the user to fill them in.
      this.sections.forEach(section => section.form.markAllAsTouched());
      this.notificationService.warning("Please fill in the required fields highlighted in red before submitting.");
      return;
    }

    if (!this.tid) {
      this.notificationService.error("Missing template ID.");
      return;
    }

    // Nothing changed since the last Submit -- don't create a duplicate workflow. (The click has
    // already committed any pending nz-input-number blur, so this reads the up-to-date form values.)
    if (!this.hasPendingChanges()) {
      return;
    }

    // 1-to-n: every Submit creates a brand-new workflow from the template with the current form
    // values applied. Reflect the values in the in-page preview first, then instantiate. Stay on the
    // page so the user can submit again to create another workflow.
    this.mergeFormValuesIntoOperatorProperties();
    this.writeOperatorPropertiesToGraph();
    const payload = this.getConfigurablePropertyUpdatePayload();
    // Name the new workflow after the (possibly user-renamed) preview workflow, so renaming the
    // preview before Submit actually names the created workflow -- otherwise every Submit would
    // reuse the template's name and all created workflows would look identical.
    const name = this.workflowActionService.getWorkflowMetadata().name;

    this.templatedWorkflowService
      .instantiateTemplatedWorkflow(this.tid, { ...payload, name })
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          // Remember what we just submitted so Submit greys out until the form changes again.
          this.lastSubmittedPayload = cloneDeep(payload.operatorProperties);
          this.notificationService.success("Workflow created. Find it under Your Work > Workflows.");
        },
        error: err => {
          console.warn("Failed to instantiate templated workflow", err);
          this.notificationService.error("Failed to create workflow.");
        },
      });
  }

  /** The macro's expanded body content with the current form values applied. */
  private buildMacroContentWithParams(): WorkflowContent {
    const content = cloneDeep(this.template!);
    this.applyTopLevelSectionValues(content);
    this.injectNestedParamOverrides(content);
    return content;
  }

  /**
   * Apply the CURRENT top-level configurable-property VALUES (e.g. ImageVisualizer's
   * image-content column) onto `content`'s matching operators. Shared by Create
   * (buildMacroContentWithParams) and the preview canvas (syncPreviewCanvasToScope)
   * so the form, the embedded canvas, and the in-place Run are ONE source of truth
   * — without this the preview keeps the macro's default values and diverges from
   * what the form shows.
   *
   * Reads from the draft service (operatorIdToProperties), NOT section.form: the
   * draft service is the live merged source of edits (it drives the schema
   * compile), whereas the section FormGroups can be mid-rebuild — and thus empty
   * — at the moment this runs from the form-change handler.
   */
  private applyTopLevelSectionValues(content: WorkflowContent): void {
    for (const op of content.operators) {
      const draftProps = this.templatedWorkflowDraftService.getOperatorProperties(op.operatorID);
      if (draftProps) {
        (op as { operatorProperties: Record<string, unknown> }).operatorProperties = {
          ...op.operatorProperties,
          ...cloneDeep(draftProps),
        };
      }
    }
  }

  /**
   * P2.4 — inject the drilled nested-macro edits (paramOverrides) into the
   * generated content. Frontend keys are the leaf's full root-relative path
   * ("nestedNodeId/.../leafOpId"); the backend MacroOpDesc.paramOverrides on a
   * Macro node is keyed RELATIVE to that node, so we strip the first segment (the
   * top-level nested Macro node's id in this content) and attach the remainder to
   * that node. The expander then applies single-segment keys to the node's own
   * body and drills multi-segment keys one level per nested Macro (P2.1). Only
   * this generation's copy is touched — the shared definition is never modified.
   */
  private injectNestedParamOverrides(content: WorkflowContent): void {
    for (const [path, props] of Object.entries(this.paramOverrides)) {
      const segments = path.split("/");
      if (segments.length < 2) continue; // needs at least nodeId/leafOpId
      const [nodeId, ...rest] = segments;
      const relKey = rest.join("/");
      const macroOp = content.operators.find(
        o => o.operatorID === nodeId && o.operatorType === "Macro"
      ) as (OperatorPredicate & { operatorProperties: Record<string, unknown> }) | undefined;
      if (!macroOp) continue;
      const overrides = {
        ...((macroOp.operatorProperties["paramOverrides"] as Record<string, unknown>) ?? {}),
        [relKey]: props,
      };
      macroOp.operatorProperties = { ...macroOp.operatorProperties, paramOverrides: overrides };
    }
  }

  /**
   * "Create Workflow": generate a new independent workflow from the macro (1-to-n).
   * Available for every macro -- a not-runnable macro (no data source) simply
   * generates an Invalid Workflow the user completes by adding a source. No
   * runnable gate here (entry is consistent for all macros).
   */
  public onCreateWorkflowFromMacro(): void {
    if (!this.macroId || !this.workflowReady) return;
    const content = this.buildMacroContentWithParams();
    // Clean default name: the "New workflow name" field, else the macro's own
    // name (never a placeholder / timestamp).
    const name = this.genName?.trim() || "Generated workflow";
    const description = this.genDescription?.trim() || undefined;
    this.macroService
      .generateWorkflowFromMacro(this.macroId, content, name, false, description)
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          // Biologists don't want to be dropped into the workflow canvas — Create
          // just SAVES the generated workflow (they see results from the in-place
          // preview Run above). Stay on the Generate page with a confirmation
          // rather than navigating into the workspace editor.
          this.notificationService.success(
            `Workflow "${name}" created — find it under Your Work › Workflows.`
          );
        },
        error: () => this.notificationService.error("Failed to generate workflow."),
      });
  }

  /**
   * "Edit macro": jump to the editable canvas to change the macro body /
   * configurable-property whitelist. The mutual return of the "return to Edit"
   * entry -- Template (this fill page) is the main page, Edit macro is the
   * config page reachable from here (and the Edit banner links back to Generate).
   * Hard nav for the same embedded-workspace-singleton reason as Create above.
   */
  public onEditMacro(): void {
    if (!this.macroId) return;
    window.location.href = `${USER_WORKSPACE}/${this.macroId}/macro/${this.macroId}`;
  }

  /**
   * Share the macro definition with other users. A macro is a `workflow` row
   * (kind=MACRO), so it reuses the exact same ShareAccessComponent the workspace
   * Share menu opens for a workflow — same access levels, same owner autocomplete
   * (retrieveOwners is a global owner list, not tied to the preview context).
   */
  public async onShareMacro(): Promise<void> {
    if (!this.macroId) return;
    this.modalService.create({
      nzContent: ShareAccessComponent,
      nzData: {
        writeAccess: this.macroIsOwner,
        type: "workflow",
        id: this.macroId,
        allOwners: await firstValueFrom(this.workflowPersistService.retrieveOwners()),
        inWorkspace: false,
      },
      nzFooter: null,
      nzTitle: "Share this macro with others",
      nzCentered: true,
      nzWidth: "800px",
    });
  }

  private getConfigurablePropertyUpdatePayload(): {
    operatorProperties: Record<string, Record<string, unknown>>;
  } {
    const operatorProperties: Record<string, Record<string, unknown>> = {};

    // Create is only reachable from the root scope (drill-in disables it), so
    // this.sections here are always the top-level editable sections. Nested-macro
    // edits live in paramOverrides and are injected separately at Create (P2.4).
    for (const section of this.sections) {
      if (section.path) continue; // nested-macro params live in paramOverrides, not here
      // Use the live form-control values, NOT section.model: after a submit/rebuild the Formly
      // `model` object can go stale, so submitting off it would apply the previously-applied value
      // instead of what the user just typed (e.g. Limit looked like it wouldn't update).
      operatorProperties[section.operatorID] = { ...section.form.getRawValue() };
    }

    return { operatorProperties };
  }

  private mergeFormValuesIntoOperatorProperties(): void {
    for (const section of this.sections) {
      if (section.path) continue; // nested-macro params are not top-level draft ops
      this.mergeSectionFormValuesIntoOperatorProperties(section);
    }
  }

  private mergeSectionFormValuesIntoOperatorProperties(section: ConfigurableSection): void {
    // Live form-control values, not section.model (which can go stale after a submit/rebuild).
    this.templatedWorkflowDraftService.mergeSectionModel(section.operatorID, section.form.getRawValue());
  }

  private writeOperatorPropertiesToGraph(): void {
    for (const section of this.sections) {
      if (section.path) continue; // nested-macro params aren't nodes in the top-level graph
      this.workflowActionService.setOperatorProperty(
        section.operatorID,
        this.templatedWorkflowDraftService.getOperatorProperties(section.operatorID)
      );
    }
  }

  /**
   * Build one section per operator that has configurableProperties, by reusing the operator's
   * own JSON schema → formly conversion and filtering to only the configurable top-level keys.
   *
   * `enrichedSchemas` maps operatorID → schema with upstream input attributes already injected as
   * enums so that attribute-selector fields render as dropdowns rather than plain text inputs.
   */
  private buildSectionsFromTemplate(
    template: { content: WorkflowContent },
    enrichedSchemas: Map<string, OperatorSchema>
  ): ConfigurableSection[] {
    const sections: ConfigurableSection[] = [];

    template.content.operators.forEach((op: OperatorPredicate) => {
      const configurableKeys = op.configurableProperties ?? [];
      if (configurableKeys.length === 0) return;

      const schema = enrichedSchemas.get(op.operatorID) ?? this.operatorMetadataService.getOperatorSchema(op.operatorType);

      const fullField = this.formlyJsonschema.toFieldConfig(cloneDeep(schema.jsonSchema) as any, {
        map: mappedField => {
          if (mappedField.key === "fileName") {
            mappedField.type = "inputautocomplete";
          }
          return mappedField;
        },
      });

      const allChildren = fullField.fieldGroup ?? [];
      const configurableSet = new Set(configurableKeys);
      const fields = allChildren.filter(
        child => typeof child.key === "string" && configurableSet.has(child.key)
      );

      if (fields.length === 0) return;

      // Seed the model from the staged draft, not the live graph.
      // This preserves unsaved user edits across schema-triggered form rebuilds.
      const draftPropsSource: Record<string, any> =
        this.templatedWorkflowDraftService.getOperatorProperties(op.operatorID) ?? op.operatorProperties;

      const model: Record<string, any> = {};
      configurableKeys.forEach(key => {
        model[key] = cloneDeep(draftPropsSource?.[key]);
      });

      sections.push({
        operatorID: op.operatorID,
        label: op.customDisplayName?.trim() ? op.customDisplayName : op.operatorType,
        fields,
        form: new FormGroup({}),
        model,
      });
    });

    return sections;
  }

  ngOnInit(): void {
    // Resolve macroId/tid + the initial page mode SYNCHRONOUSLY, before the
    // first change-detection pass. The heavy data load stays in ngAfterViewInit
    // (needs the embedded workspace ViewChild). Setting macroId here keeps the
    // header title stable from the first render -- otherwise it flips from
    // "Build workflow from template" to "Edit macro" after the view is checked,
    // which is the NG0100 ExpressionChangedAfterItHasBeenChecked error.
    const macroParam = this.route.snapshot.params.macroId;
    if (macroParam) {
      this.macroId = Number(macroParam);
    } else {
      this.tid = this.route.snapshot.params.tid;
    }
    const ret = this.route.snapshot.queryParams["ret"];
    if (ret) this.returnUrl = ret;
  }

  /** Return to the outer macro's page (set only when drilled into from a preview). */
  public onBackToOuter(): void {
    if (this.returnUrl) window.location.href = this.returnUrl;
  }

  ngAfterViewInit(): void {
    this.workflowReady = false;
    // Macro mode: generate a workflow from a macro definition (reuses this
    // whole preview + Formly + submit UI, data source swapped to the macro).
    const macroParam = this.route.snapshot.params.macroId;
    if (macroParam) {
      this.macroId = Number(macroParam);
      this.initFromMacro(this.macroId);
      return;
    }
    this.tid = this.route.snapshot.params.tid;
    if (!this.tid) return;

    forkJoin({
      template: this.templateService.retrieveTemplate(this.tid),
      metadata: this.operatorMetadataService.getOperatorMetadata(),
    })
      .pipe(untilDestroyed(this))
      .subscribe(({ template }) => {
        if (!this.tid) return;

        this.template = template.content;
        this.templatedWorkflowDraftService.initialize(template.content);

        this.templatedWorkflowService.createTemplatedWorkflow(this.tid)
          .pipe(
            switchMap(wid => {
              this.wid = wid;

              this.workflowActionService.destroySharedModel();
              this.workflowActionService.setNewSharedModel(undefined, this.userService.getCurrentUser());

              return this.workflowPersistService.retrieveWorkflow(this.wid);
            }),
            untilDestroyed(this)
          )
          .subscribe({
            next: workflow => {
              // Editing of the preview is locked by the embedded WorkspaceComponent
              // (disableWorkflowModification); we must NOT mark the workflow readonly here,
              // because a readonly workflow cannot be executed and the preview must stay runnable.
              this.workflowActionService.reloadWorkflow(workflow);

              // Reopening an existing templated workflow: /build is idempotent (returns the same
              // wid) and its content already holds the values last applied via /update. Seed the
              // form from THAT content (not the template defaults) so the user sees their last
              // edits. seedValuesFromContent keeps the enriched dynamic schemas intact (dropdowns
              // stay dropdowns); resetting the signature forces the sections to rebuild off the
              // freshly-seeded values (the signature only tracks schemas, not values).
              if (workflow.content) {
                this.templatedWorkflowDraftService.seedValuesFromContent(workflow.content);
                this.lastEnrichedSignature = "";
                this.rebuildSectionsFromDynamicSchemas();
              }

              this.workflowReady = true;
              // Reveal the preview as soon as the workflow is loaded. While the container is
              // hidden it has height:0, so the embedded JointJS paper would initialize at zero
              // size and the operators would render clipped/off-center. Showing it now lets the
              // paper size correctly and re-center on the loaded workflow.
              this.showEmbeddedWorkspace = true;
            },
            error: err => {
              this.workflowReady = false;
              console.warn("Failed to create/load templated workflow", err);
              this.notificationService.error("Failed to create workflow from template.");
            },
          });

        this.rebuildSectionsFromDynamicSchemas();

        // Do not suppress this stream. Texera's existing schema propagation may still
        // populate/enrich DynamicSchemaService, especially during initial template loading.
        this.dynamicSchemaService
          .getOperatorDynamicSchemaChangedStream()
          .pipe(debounceTime(50), untilDestroyed(this))
          .subscribe(() => this.rebuildSectionsFromDynamicSchemas());
      });
  }

  /**
   * Macro-mode init: load the macro definition, expand its body into standalone
   * workflow content (markers stripped, via T3a's converter), show it in the
   * embedded preview, and build the Formly form from the operators'
   * configurableProperties (empty form if none are declared).
   */
  private initFromMacro(macroId: number): void {
    forkJoin({
      detail: this.macroService.getMacro(macroId),
      metadata: this.operatorMetadataService.getOperatorMetadata(),
    })
      .pipe(untilDestroyed(this))
      .subscribe(({ detail }) => {
        // Defaults for the workflow that Create will produce.
        this.genName = detail.name;
        this.genDescription = detail.description ?? "";
        this.macroIsOwner = detail.isOwner;
        // P2.3 — fresh drill state per Generate entry. Clearing the caches here is
        // the invalidation strategy: definitions are re-fetched every visit, so a
        // nested macro edited between visits can never be served stale.
        this.drillStack = [];
        this.drillRows = [];
        this.paramOverrides = {};
        this.macroContentCache.clear();
        this.macroDisplayCache.clear();
        this.macroMeta.clear();
        this.runGeneratedWid = undefined;
        this.runGeneratedSignature = undefined;
        this.rootLabel = `${detail.name} v${detail.version}`;
        const content = this.macroService.macroDetailToGeneratedContent(detail);
        // Runnable gate: 0 external inputs AND a body source op. Metadata is
        // loaded above (forkJoin), so the source lookup is ready here.
        this.macroRunnable = this.macroService.isMacroRunnable(
          detail.portSpec?.inputs?.length ?? 0,
          content.operators.map(o => o.operatorType)
        );
        // The configurable-property whitelist now travels ON the body operators
        // (op.configurableProperties, set via the property-editor checkboxes in
        // Edit macro and preserved through the macro body). The fill form is
        // built straight from those — no separate whitelist source.
        this.template = content;
        this.templatedWorkflowDraftService.initialize(content);
        // P2.3 — prefetch nested macro definitions so drilling is synchronous.
        this.prefetchNestedMacros();
        // Canvas entry: clicking a Macro node on the embedded preview drills into
        // it, identical to its "Configure nested params" row. Subscribe once.
        this.macroService.previewDrillRequested$
          .pipe(untilDestroyed(this))
          .subscribe(({ nodeId }) => this.drillIntoNodeFromCanvas(nodeId));

        // Create a throwaway 'preview' workflow (filtered from the Workflows
        // list) so the embedded canvas can render the expanded body -- the
        // embedded WorkspaceComponent loads its content via [wid]. Mirrors the
        // template flow's /build step.
        this.macroService
          .generateWorkflowFromMacro(detail.wid, content, detail.name, true)
          .pipe(
            switchMap(previewWid => {
              this.wid = previewWid;
              this.workflowActionService.destroySharedModel();
              this.workflowActionService.setNewSharedModel(undefined, this.userService.getCurrentUser());
              return this.workflowPersistService.retrieveWorkflow(previewWid);
            }),
            untilDestroyed(this)
          )
          .subscribe({
            next: workflow => {
              this.rootPreviewWorkflow = workflow; // for canvas drill sync
              this.workflowActionService.reloadWorkflow(workflow);
              if (workflow.content) {
                this.templatedWorkflowDraftService.seedValuesFromContent(workflow.content);
                this.lastEnrichedSignature = "";
                this.rebuildSectionsFromDynamicSchemas();
              }
              this.workflowReady = true;
              this.showEmbeddedWorkspace = true;
            },
            error: () => this.notificationService.error("Failed to load macro preview."),
          });

        this.rebuildSectionsFromDynamicSchemas();
        this.dynamicSchemaService
          .getOperatorDynamicSchemaChangedStream()
          .pipe(debounceTime(50), untilDestroyed(this))
          .subscribe(() => this.rebuildSectionsFromDynamicSchemas());
      });
  }

  /**
   * Re-create the configurable-section list.
   *
   * Prefer draftDynamicSchemas when they exist because those reflect unsaved form edits.
   * Fall back to global DynamicSchemaService schemas for initial template schemas and any
   * existing Texera schema propagation.
   */
  private rebuildSectionsFromDynamicSchemas(): void {
    if (!this.template) return;
    // Root scope only. While drilled into a nested macro (P2.3) the visible
    // sections are managed by rebuildScope() off the static definition; the
    // dynamic-schema stream must not clobber them with the root's top-level ops.
    if (this.drillStack.length > 0) return;

    const enriched = new Map<string, OperatorSchema>();

    this.template.operators.forEach(op => {
      if (this.templatedWorkflowDraftService.hasDraftDynamicSchema(op.operatorID)) {
        enriched.set(op.operatorID, this.templatedWorkflowDraftService.getDraftDynamicSchema(op.operatorID) as OperatorSchema);
      } else if (this.dynamicSchemaService.dynamicSchemaExists(op.operatorID)) {
        enriched.set(op.operatorID, this.dynamicSchemaService.getDynamicSchema(op.operatorID));
      }
    });

    // Only rebuild the form when the schemas (i.e. the dropdown options) actually changed.
    // Rebuilding replaces every FormGroup/field instance, which destroys the input the user is
    // mid-edit -- that is why the Limit number box used to lose focus after a single digit.
    // Typing a value that does not change any schema (Limit, Filter value, condition) must NOT
    // rebuild, so the field keeps focus and multi-digit entry works.
    const signature = JSON.stringify(
      this.template.operators.map(op => [op.operatorID, enriched.get(op.operatorID)?.jsonSchema ?? null])
    );
    if (signature === this.lastEnrichedSignature && this.sections.length > 0) {
      return;
    }
    this.lastEnrichedSignature = signature;

    this.formChangesSub?.unsubscribe();
    const topLevel = this.buildSectionsFromTemplate({ content: this.template }, enriched);
    // Surface EVERY nested-macro configurable param at this outermost level too,
    // so a biologist can fill everything without drilling into nested macros.
    // Their values route to paramOverrides (see subscribeToFormChanges) and are
    // injected at Create exactly like a drilled edit.
    const nested = this.buildNestedSectionsRecursive(
      this.template.operators,
      "",
      new Set([String(this.macroId)])
    );
    this.sections = [...topLevel, ...nested];
    this.subscribeToFormChanges();
  }

  /**
   * Recursively build EDITABLE sections for every configurable leaf param inside
   * the nested macros reachable from `operators`, so all nested params show at
   * the outermost Generate page. Each section carries its full root-relative
   * `path` (nodeId/.../leafOpId) — the same key drilled edits use — so its value
   * flows to paramOverrides and is injected at Create. Cycle-guarded by macroId;
   * skips nested macros whose definition hasn't been cached yet (prefetch async).
   */
  private buildNestedSectionsRecursive(
    operators: OperatorPredicate[],
    pathPrefix: string,
    visited: Set<string>
  ): ConfigurableSection[] {
    const out: ConfigurableSection[] = [];
    for (const op of operators) {
      if (op.operatorType !== "Macro" || !op.operatorProperties?.["macroId"]) continue;
      const macroId = String(op.operatorProperties["macroId"]);
      if (visited.has(macroId)) continue; // cycle guard (A → B → A)
      const body = this.macroContentCache.get(macroId);
      if (!body) continue; // not prefetched yet — a later rebuild will include it
      const nodePath = pathPrefix ? `${pathPrefix}/${op.operatorID}` : op.operatorID;
      const groupLabel =
        this.macroMeta.get(macroId)?.name ??
        ((op.operatorProperties?.["displayName"] as string)?.trim() || "macro");
      for (const inner of body.operators) {
        if (inner.operatorType === "Macro") continue; // deeper macros handled by recursion
        if ((inner.configurableProperties ?? []).length === 0) continue;
        const section = this.buildEditableOverrideSection(inner, nodePath);
        section.groupLabel = groupLabel;
        out.push(section);
      }
      out.push(...this.buildNestedSectionsRecursive(body.operators, nodePath, new Set([...visited, macroId])));
    }
    return out;
  }

  /**
   * P2.3 — prefetch every reachable nested macro DEFINITION (getMacro) into
   * macroContentCache / macroMeta so the focused-drill view can switch levels
   * synchronously. Recursion is cycle-guarded (A→B→A stops). Caches are cleared
   * on each Generate entry (initFromMacro) so a nested definition edited between
   * visits is never served stale — see the reset there.
   */
  private prefetchNestedMacros(): void {
    if (!this.template || this.macroId === undefined) return;
    this.walkAndCacheNestedMacros(this.template.operators, new Set([String(this.macroId)]))
      .pipe(untilDestroyed(this))
      .subscribe(() => this.rebuildScope());
  }

  /**
   * Recursively fetch + cache the definitions of the nested Macro nodes in
   * `operators`. `visited` is the set of macro wids on the current path (cycle
   * guard); an already-cached macro is not re-walked (its subtree is done).
   */
  private walkAndCacheNestedMacros(operators: OperatorPredicate[], visited: Set<string>): Observable<void> {
    const macroIds = operators
      .filter(op => op.operatorType === "Macro" && op.operatorProperties?.["macroId"])
      .map(op => String(op.operatorProperties!["macroId"]))
      .filter(id => !visited.has(id) && !this.macroContentCache.has(id));
    if (macroIds.length === 0) return of(void 0);

    const per = macroIds.map(macroId =>
      this.macroService.getMacro(Number(macroId)).pipe(
        switchMap(detail => {
          this.macroMeta.set(macroId, { name: detail.name, version: detail.version });
          const content = this.macroService.macroDetailToGeneratedContent(detail);
          this.macroContentCache.set(macroId, content);
          // Marker-inclusive copy for the drilled canvas (shows in/out boundary).
          this.macroDisplayCache.set(macroId, this.macroService.macroDetailToWorkflow(detail).content);
          return this.walkAndCacheNestedMacros(content.operators, new Set([...visited, macroId]));
        }),
        // Can't fetch (deleted / no access): skip that branch, don't fail the form.
        catchError(() => of(void 0))
      )
    );
    return forkJoin(per).pipe(map(() => void 0));
  }

  /**
   * Rebuild the visible form for the CURRENT drill scope.
   *  - root (empty stack): the top-level editable sections (dynamic-schema path)
   *    plus a drill row per top-level nested Macro node;
   *  - drilled: that macro's own configurable leaf params rendered EDITABLE
   *    (seeded from paramOverrides else the definition default), plus drill rows
   *    for its own nested macros.
   */
  private rebuildScope(): void {
    if (this.drillStack.length === 0) {
      // Force a fresh root build: returning from a drilled level leaves
      // this.sections holding the drilled sections, but the root schema signature
      // is unchanged, so the signature-skip in rebuildSectionsFromDynamicSchemas
      // would early-return and keep the wrong sections. Reset it so root rebuilds.
      this.lastEnrichedSignature = "";
      this.rebuildSectionsFromDynamicSchemas();
      this.drillRows = this.buildDrillRows(this.template?.operators ?? [], "", new Set([String(this.macroId)]));
      return;
    }
    const level = this.drillStack[this.drillStack.length - 1];
    const content = this.macroContentCache.get(level.macroId);
    this.formChangesSub?.unsubscribe();
    this.sections = (content?.operators ?? [])
      .filter(op => (op.configurableProperties ?? []).length > 0)
      .map(op => this.buildEditableOverrideSection(op, level.path));
    this.subscribeDrilledOverrides();
    // Cycle guard = every macro wid on the current path (root + each drilled level).
    const pathMacroIds = new Set<string>([String(this.macroId), ...this.drillStack.map(l => l.macroId)]);
    this.drillRows = this.buildDrillRows(content?.operators ?? [], level.path, pathMacroIds);
  }

  /** Drill rows for the nested Macro nodes at the given scope. */
  private buildDrillRows(operators: OperatorPredicate[], pathPrefix: string, pathMacroIds: Set<string>): DrillRow[] {
    return operators
      .filter(op => op.operatorType === "Macro" && op.operatorProperties?.["macroId"])
      .map(op => {
        const macroId = String(op.operatorProperties!["macroId"]);
        const nodePath = pathPrefix ? `${pathPrefix}/${op.operatorID}` : op.operatorID;
        const meta = this.macroMeta.get(macroId);
        // Breadcrumb/label carries the definition name + version (e.g. "limit_filter v22").
        const label = meta
          ? `${meta.name} v${meta.version}`
          : ((op.operatorProperties?.["displayName"] as string)?.trim() || "macro");
        return { nodeId: op.operatorID, macroId, label, path: nodePath, cycle: pathMacroIds.has(macroId) };
      });
  }

  /**
   * Build an EDITABLE section for one nested configurable leaf op. Values are
   * seeded from an existing override (this generation's earlier edit) else the
   * definition default; edits flow to paramOverrides[path] via
   * subscribeDrilledOverrides. `path` is the leaf's path relative to the root and
   * is the key P2.4 injects on.
   */
  private buildEditableOverrideSection(op: OperatorPredicate, pathPrefix: string): ConfigurableSection {
    const path = `${pathPrefix}/${op.operatorID}`;
    const configurableKeys = op.configurableProperties ?? [];
    // Enrich with this op's RESOLVED input schema (keyed by its node path in the
    // compile result) so attribute-selector fields render as column dropdowns —
    // at any depth, including ops fed across the macro boundary. Falls back to the
    // static schema (free text) if the compile hasn't populated it yet.
    const inputSchema = this.lastRawOutputSchemas[path];
    const schema = WorkflowCompilingService.setOperatorInputAttrs(
      this.operatorMetadataService.getOperatorSchema(op.operatorType),
      inputSchema
    );
    const fullField = this.formlyJsonschema.toFieldConfig(cloneDeep(schema.jsonSchema) as any);
    const configurableSet = new Set(configurableKeys);
    const fields = (fullField.fieldGroup ?? []).filter(
      child => typeof child.key === "string" && configurableSet.has(child.key)
    );

    const override = this.paramOverrides[path] ?? {};
    const source = op.operatorProperties ?? {};
    const model: Record<string, any> = {};
    configurableKeys.forEach(
      key => (model[key] = cloneDeep(override[key] !== undefined ? override[key] : source[key]))
    );

    return {
      operatorID: op.operatorID,
      label: op.customDisplayName?.trim() || op.operatorType,
      fields,
      form: new FormGroup({}),
      model,
      path,
      depth: path.split("/").length,
    };
  }

  /** Pipe drilled-section edits into paramOverrides[path] (injected at Create, P2.4). */
  private subscribeDrilledOverrides(): void {
    this.formChangesSub?.unsubscribe();
    if (this.sections.length === 0) return;
    const streams = this.sections.map(section =>
      section.form.valueChanges.pipe(
        map(() => {
          if (section.path) this.paramOverrides[section.path] = { ...section.form.getRawValue() };
        })
      )
    );
    this.formChangesSub = merge(...streams).pipe(untilDestroyed(this)).subscribe();
  }

  /** Drill into a nested macro (focused view). Refused on an A→B→A cycle. */
  public drillInto(row: DrillRow): void {
    if (row.cycle) {
      this.notificationService.warning(`${row.label}: nested reference cycle — cannot drill in.`);
      return;
    }
    this.drillStack = [...this.drillStack, { macroId: row.macroId, nodeId: row.nodeId, label: row.label, path: row.path }];
    this.rebuildScope();
    this.syncPreviewCanvasToScope();
    this.refreshDrillSchemas();
  }

  /** Breadcrumb navigation: index 0 = root, i = the i-th drilled level. */
  public drillTo(index: number): void {
    this.drillStack = index <= 0 ? [] : this.drillStack.slice(0, index);
    this.rebuildScope();
    this.syncPreviewCanvasToScope();
    this.refreshDrillSchemas();
  }

  public drillBack(): void {
    this.drillStack = this.drillStack.slice(0, -1);
    this.rebuildScope();
    this.syncPreviewCanvasToScope();
    this.refreshDrillSchemas();
  }

  /**
   * Run the whole generated workflow from a drilled nested scope, so a biologist
   * can edit nested params and run without manually navigating back out.
   *
   * A nested body isn't standalone-runnable (its input is the macro boundary, so
   * it has no data source), so "run here" necessarily means "run the full graph".
   * Drilled edits already flow live into paramOverrides (subscribeToDrillFormChanges),
   * so we just return to root scope — syncPreviewCanvasToScope bakes those
   * overrides into the root graph and loads it into the shared model — then
   * trigger the same in-place preview Run the root view uses. The canvas returns
   * to root because that is the graph being executed.
   */
  public runWholeWorkflowFromNested(): void {
    if (this.drillStack.length === 0) return;
    this.drillStack = [];
    this.rebuildScope();
    this.syncPreviewCanvasToScope();
    // Defer to a macrotask so Angular re-evaluates [previewRunDelegated] (now
    // false, since drillStack is empty) BEFORE we call runPreview — otherwise
    // runPreview would still be delegated and re-emit, looping back here.
    setTimeout(() => this.triggerPreviewRunWhenReady(), 0);
  }

  /**
   * Fire the embedded preview Run once it's runnable (the [previewRunnable] input
   * flips true after returning to root, and the CU websocket must be connected).
   * Polls briefly rather than assuming a single tick is enough.
   */
  private triggerPreviewRunWhenReady(attemptsLeft = 20): void {
    const ws = this.previewWorkspace;
    if (ws?.previewCanRun) {
      ws.runPreview();
      return;
    }
    if (attemptsLeft <= 0) return; // stays at root with its own Run button as fallback
    setTimeout(() => this.triggerPreviewRunWhenReady(attemptsLeft - 1), 100);
  }

  /**
   * When drilled, (re)compile the full expanded plan and capture the path-keyed
   * inner-op input schemas, then re-enrich the drilled sections so their
   * attribute-selector fields become column dropdowns. Async: the dropdowns
   * appear a beat after drilling if the schema wasn't already cached.
   */
  private refreshDrillSchemas(): void {
    if (this.drillStack.length === 0) return;
    this.compileDraftWorkflowForDynamicSchemas()
      .pipe(untilDestroyed(this))
      .subscribe(r => {
        if (!r.operatorOutputSchemas) return;
        this.lastRawOutputSchemas = r.operatorOutputSchemas;
        if (this.drillStack.length > 0) this.rebuildScope(); // re-enrich with fresh schemas
      });
  }

  /**
   * Re-render the embedded preview canvas to match the current drill scope, so
   * "which level am I in" reads the same in the params panel AND the canvas.
   * Root scope → the root preview body; a drilled level → that nested macro's
   * definition body (from the prefetch cache). Reuses the shared
   * WorkflowActionService the embedded workspace renders from; content is the
   * same positioned WorkflowContent macroDetailToGeneratedContent already
   * produces (so reloadWorkflow has operatorPositions for every op).
   */
  private syncPreviewCanvasToScope(): void {
    if (!this.rootPreviewWorkflow) return;
    let content: WorkflowContent | undefined;
    if (this.drillStack.length === 0) {
      // Bake the drilled nested-param overrides into the root graph so the
      // in-place preview Run (which executes the shared graph, and is only
      // offered at root) reflects them — otherwise overrides apply only at
      // Create and the preview runs stale defaults. Deterministic from the
      // paramOverrides state, so no dependency on form-render timing.
      const rootContent = cloneDeep(this.rootPreviewWorkflow.content);
      this.applyTopLevelSectionValues(rootContent);
      this.injectNestedParamOverrides(rootContent);
      content = rootContent;
    } else {
      // Prefer the marker-inclusive body so the canvas shows the macro's in/out
      // boundary (MacroInput/MacroOutput). Fall back to the stripped body if a
      // display copy wasn't cached (older prefetch path).
      const drilledMacroId = this.drillStack[this.drillStack.length - 1].macroId;
      content = this.macroDisplayCache.get(drilledMacroId) ?? this.macroContentCache.get(drilledMacroId);
    }
    if (!content) return;
    this.workflowActionService.reloadWorkflow({ ...this.rootPreviewWorkflow, content });
  }

  public get breadcrumb(): string[] {
    return [this.rootLabel || "root", ...this.drillStack.map(l => l.label)];
  }

  /**
   * Canvas entry point: a Macro node was double-clicked on the embedded preview.
   * Drill into it from the CURRENT scope (drillRows always reflects the current
   * scope; nodeId is the operator id the canvas element carries). Deeper canvas
   * drilling has a separate event-plumbing issue tracked outside this method —
   * the "Configure nested params" row drills reliably at any depth.
   */
  private drillIntoNodeFromCanvas(nodeId: string): void {
    const row = this.drillRows.find(r => r.nodeId === nodeId);
    if (row) this.drillInto(row);
  }

  /**
   * Pipe user edits from each section's form into a draft compile.
   *
   * This keeps downstream dynamic dropdowns responsive without mutating the shared workflow graph
   * before SUBMIT. For now, only fileName is treated as schema-driving because that is the known
   * required propagation path.
   */
  private subscribeToFormChanges(): void {
    if (this.sections.length === 0) return;

    const valueChangeStreams = this.sections.map(section =>
      section.form.valueChanges.pipe(
        map(nextModel => {
          // Nested-macro params surfaced at root carry a `path`: route their
          // values into paramOverrides (keyed by the leaf's full path), which
          // injectNestedParamOverrides applies at Create + preview. Top-level
          // sections go into the draft service by operatorID as before.
          if (section.path) {
            this.paramOverrides[section.path] = { ...section.form.getRawValue() };
            return true;
          }
          return this.templatedWorkflowDraftService.mergeSectionModelIfChanged(section.operatorID, nextModel);
        }),
        filter(changed => changed)
      )
    );

    this.formChangesSub = merge(...valueChangeStreams)
      .pipe(
        debounceTime(300),
        switchMap(() => this.compileDraftWorkflowForDynamicSchemas()),
        untilDestroyed(this)
      )
      .subscribe(response => {
        if (response.operatorOutputSchemas) {
          this.applyDraftSchemaPropagationResult(response.operatorOutputSchemas);
        }
        // Reflect the top-level form edits on the embedded preview canvas (and
        // therefore the in-place Run, which executes the shared graph) so the
        // form and the canvas can't drift apart. Only at root scope — the drilled
        // canvas shows a nested body whose params live in paramOverrides. The
        // form inputs are a separate component, so reloading the canvas does not
        // disturb form focus.
        if (this.drillStack.length === 0) {
          this.syncPreviewCanvasToScope();
        }
      });
  }

  private compileDraftWorkflowForDynamicSchemas(): Observable<WorkflowCompilationResponse> {
    if (!this.template) {
      return EMPTY;
    }

    const logicalPlan = this.templatedWorkflowDraftService.buildDraftLogicalPlan(this.template);

    const body = {
      operators: logicalPlan.operators,
      links: logicalPlan.links,
      opsToReuseResult: [],
      opsToViewResult: [],
    };

    return this.http
      .post<WorkflowCompilationResponse>(
        `${AppSettings.getApiEndpoint()}/${WORKFLOW_COMPILATION_ENDPOINT}`,
        JSON.stringify(body),
        {
          headers: new HttpHeaders({
            "Content-Type": "application/json",
          }),
        }
      )
      .pipe(
        catchError((err: unknown) => {
          console.warn("compile draft workflow API returns error", err);
          return EMPTY;
        })
      );
  }

  private applyDraftSchemaPropagationResult(outputSchemas: Record<string, OperatorPortSchemaMap>): void {
    if (!this.template) return;
    this.lastRawOutputSchemas = outputSchemas; // incl. path-keyed inner-op input schemas

    this.templatedWorkflowDraftService.applyDraftSchemaPropagationResult({
      content: this.template,
      outputSchemas,
      getBaseSchema: op => this.getBaseSchemaForOperator(op),
    });

    this.rebuildSectionsFromDynamicSchemas();
  }

  private getBaseSchemaForOperator(op: OperatorPredicate): OperatorSchema {
    if (this.dynamicSchemaService.dynamicSchemaExists(op.operatorID)) {
      return this.dynamicSchemaService.getDynamicSchema(op.operatorID);
    }

    return this.operatorMetadataService.getOperatorSchema(op.operatorType);
  }
}
