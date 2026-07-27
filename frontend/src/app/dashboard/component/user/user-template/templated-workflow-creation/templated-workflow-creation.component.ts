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
import {AfterViewInit, Component, OnInit} from "@angular/core";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {NotificationService} from "../../../../../common/service/notification/notification.service";
import {UserService} from "../../../../../common/service/user/user.service";
import {WorkflowActionService} from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import {WorkflowContent} from "../../../../../common/type/workflow";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {AppSettings} from "../../../../../common/app-setting";
import {HttpClient, HttpHeaders} from "@angular/common/http";
import {catchError, debounceTime, EMPTY, forkJoin, merge, Observable, of, Subscription} from "rxjs";
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

interface ConfigurableSection {
  operatorID: string;
  label: string;
  fields: FormlyFieldConfig[];
  form: FormGroup;
  model: Record<string, any>;
  // P2.2 — sections bubbled up from a NESTED macro's definition are shown
  // read-only here (drill-to-edit lands in P2.3, injection in P2.4). `path` is
  // the operator path relative to this generation's root
  // ("nestedMacroNodeId/.../leafOpId"), which keys the override map P2.4 injects;
  // `depth` (1 = first nesting level) drives the indented display. `cycle` marks
  // a section that only reports an A→B→A reference was cut, with no editable
  // fields.
  readOnly?: boolean;
  path?: string;
  depth?: number;
  cycle?: boolean;
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
  // P2.2 — read-only sections bubbled from the nested macro DEFINITIONS. Computed
  // once (async, recursive) after the body loads, then re-appended after every
  // top-level rebuild so schema-driven rebuilds don't drop them.
  private nestedSections: ConfigurableSection[] = [];
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
        this.executionState = event.current.state;
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
    const payload = this.getConfigurablePropertyUpdatePayload();
    const content = cloneDeep(this.template!);
    for (const [opId, props] of Object.entries(payload.operatorProperties)) {
      const op = content.operators.find(o => o.operatorID === opId);
      if (op) {
        (op as { operatorProperties: Record<string, unknown> }).operatorProperties = {
          ...op.operatorProperties,
          ...props,
        };
      }
    }
    return content;
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
        next: newWid => {
          this.notificationService.success("Workflow generated. Find it under Your Work > Workflows.");
          // Hard navigation (not router.navigate): this page embeds a
          // WorkspaceComponent that shares the singleton WorkflowActionService
          // with the target workspace. An SPA transition reuses that state and
          // races YJS replay vs reloadWorkflow, leaving the new canvas
          // transiently blank. A full reload gives the target a clean slate --
          // same reason the macro drill-down uses window.location.href.
          window.location.href = `${USER_WORKSPACE}/${newWid}`;
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

  private getConfigurablePropertyUpdatePayload(): {
    operatorProperties: Record<string, Record<string, unknown>>;
  } {
    const operatorProperties: Record<string, Record<string, unknown>> = {};

    // Read-only nested sections (P2.2) are display-only — their leaf-op IDs don't
    // exist in this top-level content and their injection is wired separately in
    // P2.4, so they must never enter the submit payload.
    for (const section of this.sections.filter(s => !s.readOnly)) {
      // Use the live form-control values, NOT section.model: after a submit/rebuild the Formly
      // `model` object can go stale, so submitting off it would apply the previously-applied value
      // instead of what the user just typed (e.g. Limit looked like it wouldn't update).
      operatorProperties[section.operatorID] = { ...section.form.getRawValue() };
    }

    return { operatorProperties };
  }

  private mergeFormValuesIntoOperatorProperties(): void {
    for (const section of this.sections.filter(s => !s.readOnly)) {
      this.mergeSectionFormValuesIntoOperatorProperties(section);
    }
  }

  private mergeSectionFormValuesIntoOperatorProperties(section: ConfigurableSection): void {
    // Live form-control values, not section.model (which can go stale after a submit/rebuild).
    this.templatedWorkflowDraftService.mergeSectionModel(section.operatorID, section.form.getRawValue());
  }

  private writeOperatorPropertiesToGraph(): void {
    for (const section of this.sections.filter(s => !s.readOnly)) {
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
        // P2.2 — bubble up read-only sections for any nested macro's params.
        this.computeNestedMacroSections();

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
    this.sections = this.buildSectionsFromTemplate({ content: this.template }, enriched);
    // Keep the already-computed read-only nested sections (P2.2) attached; the
    // top-level rebuild above replaces the array, so re-append them here.
    if (this.nestedSections.length > 0) {
      this.sections = [...this.sections, ...this.nestedSections];
    }
    this.subscribeToFormChanges();
  }

  /**
   * P2.2 — asynchronously walk the nested Macro nodes in the generated body and
   * build a read-only configurable section for every nested configurable leaf
   * param, sourced from each nested macro's DEFINITION (getMacro) rather than the
   * embedded snapshot, keyed by its path relative to this generation's root.
   * Read-only here; P2.3 makes them drillable to edit and P2.4 wires the edits
   * into the injected override map.
   *
   * Cycle guard: a macro whose wid already appears on the current path (A→B→A) is
   * cut with a note section instead of recursing forever.
   */
  private computeNestedMacroSections(): void {
    if (!this.template || this.macroId === undefined) return;
    const rootId = String(this.macroId);
    this.collectNestedSections(this.template.operators, "", new Set([rootId]))
      .pipe(untilDestroyed(this))
      .subscribe(sections => {
        this.nestedSections = sections;
        // Re-append onto the current top-level sections (the schema signature is
        // unchanged, so rebuild would early-return and not pick these up).
        const topLevel = this.sections.filter(s => !s.readOnly);
        this.sections = [...topLevel, ...this.nestedSections];
      });
  }

  /**
   * Recursively collect read-only sections for the nested Macro nodes found in
   * `operators`. `pathPrefix` is the path to the containing scope ("" at root);
   * `visited` is the set of macro wids already on this path (cycle guard).
   */
  private collectNestedSections(
    operators: OperatorPredicate[],
    pathPrefix: string,
    visited: Set<string>
  ): Observable<ConfigurableSection[]> {
    const macroOps = operators.filter(
      op => op.operatorType === "Macro" && op.operatorProperties?.["macroId"]
    );
    if (macroOps.length === 0) return of([]);

    const perMacro = macroOps.map(macroOp => {
      const macroId = String(macroOp.operatorProperties!["macroId"]);
      const nodePath = pathPrefix ? `${pathPrefix}/${macroOp.operatorID}` : macroOp.operatorID;
      const depth = nodePath.split("/").length;
      const label =
        macroOp.customDisplayName?.trim() ||
        (macroOp.operatorProperties?.["displayName"] as string)?.trim() ||
        "macro";

      if (visited.has(macroId)) {
        // A→B→A: the macro references an ancestor. Cut here with a note.
        return of<ConfigurableSection[]>([this.makeCycleNoteSection(nodePath, label, depth)]);
      }

      return this.macroService.getMacro(Number(macroId)).pipe(
        map(detail => this.macroService.macroDetailToGeneratedContent(detail)),
        switchMap(content => {
          const own = content.operators
            .filter(op => (op.configurableProperties ?? []).length > 0)
            .map(op => this.buildReadOnlySection(op, `${nodePath}/${op.operatorID}`, depth, label));
          return this.collectNestedSections(
            content.operators,
            nodePath,
            new Set([...visited, macroId])
          ).pipe(map(deeper => [...own, ...deeper]));
        }),
        // Can't fetch the definition (deleted / no access): skip that branch
        // rather than fail the whole form.
        catchError(() => of<ConfigurableSection[]>([]))
      );
    });

    return forkJoin(perMacro).pipe(map(arrays => arrays.flat()));
  }

  /**
   * Build a disabled (read-only) section for one nested configurable leaf op.
   * Fields are populated from the operator's own JSON schema and its definition
   * default values, then each control disables itself on init so ng-zorro inputs
   * render greyed and non-editable.
   */
  private buildReadOnlySection(
    op: OperatorPredicate,
    path: string,
    depth: number,
    parentLabel: string
  ): ConfigurableSection {
    const configurableKeys = op.configurableProperties ?? [];
    const schema = this.operatorMetadataService.getOperatorSchema(op.operatorType);
    const fullField = this.formlyJsonschema.toFieldConfig(cloneDeep(schema.jsonSchema) as any);
    const configurableSet = new Set(configurableKeys);
    const fields = (fullField.fieldGroup ?? [])
      .filter(child => typeof child.key === "string" && configurableSet.has(child.key))
      .map(child => ({
        ...child,
        // Disable on init: reliable read-only for ng-zorro reactive-form controls
        // (setDisabledState greys + blocks the input); getRawValue still returns
        // the value so P2.4 can read it.
        hooks: { ...child.hooks, onInit: (f: FormlyFieldConfig) => f.formControl?.disable() },
      }));

    const source = op.operatorProperties ?? {};
    const model: Record<string, any> = {};
    configurableKeys.forEach(key => (model[key] = cloneDeep(source[key])));

    return {
      operatorID: op.operatorID,
      label: `${parentLabel} › ${op.customDisplayName?.trim() || op.operatorType}`,
      fields,
      form: new FormGroup({}),
      model,
      readOnly: true,
      path,
      depth,
    };
  }

  /** A→B→A cycle note: a read-only section with no fields, just a message. */
  private makeCycleNoteSection(path: string, label: string, depth: number): ConfigurableSection {
    return {
      operatorID: path,
      label: `${label} — nested reference cycle detected, not expanded`,
      fields: [],
      form: new FormGroup({}),
      model: {},
      readOnly: true,
      cycle: true,
      path,
      depth,
    };
  }

  /**
   * Pipe user edits from each section's form into a draft compile.
   *
   * This keeps downstream dynamic dropdowns responsive without mutating the shared workflow graph
   * before SUBMIT. For now, only fileName is treated as schema-driving because that is the known
   * required propagation path.
   */
  private subscribeToFormChanges(): void {
    // Only editable (top-level) sections drive dynamic-schema recompiles;
    // read-only nested sections (P2.2) are disabled and emit nothing.
    const editable = this.sections.filter(s => !s.readOnly);
    if (editable.length === 0) return;

    const valueChangeStreams = editable.map(section =>
      section.form.valueChanges.pipe(
        map(nextModel =>
          this.templatedWorkflowDraftService.mergeSectionModelIfChanged(
            section.operatorID,
            nextModel
          )
        ),
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
        if (!response.operatorOutputSchemas) {
          return;
        }
        this.applyDraftSchemaPropagationResult(response.operatorOutputSchemas);
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
