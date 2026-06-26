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
import {AfterViewInit, ChangeDetectorRef, Component} from "@angular/core";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {NotificationService} from "../../../../../common/service/notification/notification.service";
import {UserService} from "../../../../../common/service/user/user.service";
import {WorkflowActionService} from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import {WorkflowContent} from "../../../../../common/type/workflow";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {AppSettings} from "../../../../../common/app-setting";
import {HttpClient, HttpHeaders} from "@angular/common/http";
import {catchError, debounceTime, EMPTY, forkJoin, merge, Observable, Subscription} from "rxjs";
import {filter, finalize, map, switchMap} from "rxjs/operators";
import {TemplatedWorkflowService} from "../../../../service/user/templated-workflow/templated-workflow.service";
import {cloneDeep, isEqual} from "lodash";
import {ActivatedRoute} from "@angular/router";
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
import {NzTooltipModule} from "ng-zorro-antd/tooltip";
import {WorkspaceComponent} from "../../../../../workspace/component/workspace.component";

interface ConfigurableSection {
  operatorID: string;
  label: string;
  fields: FormlyFieldConfig[];
  form: FormGroup;
  model: Record<string, any>;
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
    NzTooltipModule,
    WorkspaceComponent,
  ],
})
export class TemplatedWorkflowCreationComponent implements AfterViewInit {
  public tid: number | undefined;
  public wid: number | undefined;
  public template: WorkflowContent | undefined;

  public sections: ConfigurableSection[] = [];
  public isLogin: boolean = this.userService.isLogin();
  public currentUid: number | undefined;
  public executionState: ExecutionState = ExecutionState.Uninitialized;
  public ExecutionState = ExecutionState;

  // Recreated whenever sections are rebuilt because each rebuild creates new FormGroup instances.
  private formChangesSub: Subscription | undefined;

  // Controls the embedded read-only preview. Kept hidden until a submit succeeds, and briefly
  // toggled off/on after each successful update so the preview re-fetches the updated workflow.
  public showEmbeddedWorkspace = false;

  // The configurable-property values last successfully applied to the workflow, keyed by
  // operatorID. Compared against the current form values on submit to report "No changes".
  private appliedValues: Record<string, Record<string, unknown>> = {};

  // True while a build/update request is in flight, to disable the button and avoid double submits.
  public isSubmitting = false;

  constructor(
    private notificationService: NotificationService,
    private userService: UserService,
    private workflowActionService: WorkflowActionService,
    private templateService: TemplateService,
    private templatedWorkflowDraftService: TemplatedWorkflowDraftService,
    private templatedWorkflowService: TemplatedWorkflowService,
    private workflowPersistService: WorkflowPersistService,
    private executeWorkflowService: ExecuteWorkflowService,
    private operatorMetadataService: OperatorMetadataService,
    private dynamicSchemaService: DynamicSchemaService,
    // injected to ensure the singleton WorkflowCompilingService is instantiated
    private workflowCompilingService: WorkflowCompilingService,
    private formlyJsonschema: FormlyJsonschema,
    private route: ActivatedRoute,
    private http: HttpClient,
    private changeDetectorRef: ChangeDetectorRef
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

  // "Submit" before the workflow exists (the first submit creates it), "Update" afterwards.
  public get submitButtonText(): string {
    return this.wid === undefined ? "Submit" : "Update";
  }

  // The button stays enabled (except while a request is in flight). Validation happens on click so
  // the user always gets clear feedback -- about missing required fields, or that nothing changed --
  // instead of a button that is mysteriously greyed out.
  public onJobFormSubmitted(): void {
    if (this.isSubmitting) {
      return;
    }

    if (this.isWorkflowExecutionActive) {
      this.notificationService.warning(
        "Cannot submit while the workflow is running. Stop or wait for it to finish, then try again."
      );
      return;
    }

    if (!this.tid) {
      this.notificationService.error("Missing template ID.");
      return;
    }

    // Required-but-empty fields: surface them (they turn red) and tell the user what to do.
    if (!this.formValid) {
      this.sections.forEach(section => section.form.markAllAsTouched());
      this.notificationService.error("Please fill in all required fields before submitting.");
      return;
    }

    const payload = this.getConfigurablePropertyUpdatePayload();

    // Nothing changed since the last successful submit: say so instead of a silent no-op.
    if (this.wid !== undefined && isEqual(payload.operatorProperties, this.appliedValues)) {
      this.notificationService.info("No changes to apply.");
      return;
    }

    const isFirstSubmit = this.wid === undefined;
    this.isSubmitting = true;

    // Get-or-create the workflow instantiated from this template (idempotent: the backend returns
    // the existing wid without clobbering already-configured values), then apply the configurable
    // property values server-side via /{wid}/update. Doing the apply on the backend (with the raw
    // submitted values) is what makes typed values such as file references update correctly, and it
    // supports unlimited re-submits.
    this.templatedWorkflowService
      .createTemplatedWorkflow(this.tid)
      .pipe(
        switchMap(wid => {
          this.wid = wid;
          return this.templatedWorkflowService.updateTemplatedWorkflowProperties(wid, payload);
        }),
        finalize(() => {
          this.isSubmitting = false;
        }),
        untilDestroyed(this)
      )
      .subscribe({
        next: () => {
          this.appliedValues = cloneDeep(payload.operatorProperties);
          this.notificationService.success(
            isFirstSubmit ? "Workflow created and properties applied." : "Workflow updated."
          );
          this.reloadEmbeddedPreview();
        },
        error: (err: unknown) => {
          console.warn("Failed to build/update templated workflow", err);
          this.notificationService.error("Failed to update workflow from template.");
        },
      });
  }

  /**
   * Collect the configurable-property values from each section's form, keyed by operatorID, as the
   * request body for /{wid}/update. The backend rejects any property not in the operator's
   * configurableProperties whitelist, so it is safe to send the section model as-is.
   */
  private getConfigurablePropertyUpdatePayload(): {
    operatorProperties: Record<string, Record<string, unknown>>;
  } {
    const operatorProperties: Record<string, Record<string, unknown>> = {};
    for (const section of this.sections) {
      operatorProperties[section.operatorID] = { ...section.model };
    }
    return { operatorProperties };
  }

  /**
   * Force the embedded read-only workspace to re-fetch the workflow so the just-applied property
   * values (and any resulting downstream schema changes) show up in the preview.
   *
   * Destroy and recreate the component deterministically via detectChanges() rather than a
   * setTimeout toggle: toggling a boolean in an async callback could be collapsed into a single
   * change-detection pass, leaving the old (stale) preview in place. The synchronous tear-down is
   * safe because an embedded workspace skips its destructive teardown (see WorkspaceComponent).
   */
  private reloadEmbeddedPreview(): void {
    this.showEmbeddedWorkspace = false;
    this.changeDetectorRef.detectChanges();
    this.showEmbeddedWorkspace = true;
    this.changeDetectorRef.detectChanges();
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

  ngAfterViewInit(): void {
    this.tid = this.route.snapshot.params.tid;
    if (!this.tid) return;

    // Get-or-create the workflow instantiated from this template up front, then build the form
    // from the WORKFLOW's CURRENT content -- not the raw template. This is essential: the form
    // must show the values that are actually saved (e.g. a Limit the user set earlier), otherwise
    // submitting would send template defaults for the un-edited fields and silently reset them.
    forkJoin({
      wid: this.templatedWorkflowService.createTemplatedWorkflow(this.tid),
      metadata: this.operatorMetadataService.getOperatorMetadata(),
    })
      .pipe(
        switchMap(({ wid }) => {
          this.wid = wid;
          return this.workflowPersistService.retrieveWorkflow(wid);
        }),
        untilDestroyed(this)
      )
      .subscribe(workflow => {
        // The instantiated workflow's content is the source of truth for the form.
        this.template = workflow.content;
        this.templatedWorkflowDraftService.initialize(workflow.content);

        // We deliberately do NOT load anything into the shared WorkflowActionService here: that
        // singleton is what the embedded preview renders. The embedded preview loads the real
        // workflow by wid on its own; attribute-dropdown enrichment comes from the draft compile
        // path below, so the shared graph (and thus the preview) is never polluted.
        this.rebuildSectionsFromDynamicSchemas();

        // Baseline: the values currently in the workflow. Submitting without edits is then a
        // genuine "no change", and editing one field sends the real current values for the rest
        // (so nothing gets reset to template defaults).
        this.appliedValues = cloneDeep(this.getConfigurablePropertyUpdatePayload().operatorProperties);

        // Show the preview of the actual workflow.
        this.showEmbeddedWorkspace = true;

        // Initial enrichment so attribute selectors show their dropdown options before any edit,
        // without touching the shared graph.
        this.compileDraftWorkflowForDynamicSchemas()
          .pipe(untilDestroyed(this))
          .subscribe(response => {
            if (response.operatorOutputSchemas) {
              this.applyDraftSchemaPropagationResult(response.operatorOutputSchemas);
            }
          });
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

    this.formChangesSub?.unsubscribe();

    const enriched = new Map<string, OperatorSchema>();

    this.template.operators.forEach(op => {
      if (this.templatedWorkflowDraftService.hasDraftDynamicSchema(op.operatorID)) {
        enriched.set(op.operatorID, this.templatedWorkflowDraftService.getDraftDynamicSchema(op.operatorID) as OperatorSchema);
      } else if (this.dynamicSchemaService.dynamicSchemaExists(op.operatorID)) {
        enriched.set(op.operatorID, this.dynamicSchemaService.getDynamicSchema(op.operatorID));
      }
    });

    this.sections = this.buildSectionsFromTemplate({ content: this.template }, enriched);
    this.subscribeToFormChanges();
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
