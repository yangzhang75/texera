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
import {AfterViewInit, Component} from "@angular/core";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {NotificationService} from "../../../../../common/service/notification/notification.service";
import {UserService} from "../../../../../common/service/user/user.service";
import {WorkflowActionService} from "../../../../../workspace/service/workflow-graph/model/workflow-action.service";
import {Workflow, WorkflowContent} from "../../../../../common/type/workflow";
import {WorkflowPersistService} from "../../../../../common/service/workflow-persist/workflow-persist.service";
import {AppSettings} from "../../../../../common/app-setting";
import {HttpClient, HttpHeaders} from "@angular/common/http";
import {catchError, debounceTime, EMPTY, forkJoin, merge, Observable, of, Subscription, tap} from "rxjs";
import {filter, finalize, map, switchMap} from "rxjs/operators";
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
import {TemplatedWorkflowService} from "../../../../service/user/templated-workflow/templated-workflow.service";

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
  private workflowReady: boolean = false;
  public showEmbeddedWorkspace = false;

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
    private http: HttpClient
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

  // Cosmetic "nothing to apply" state: the button looks grey but stays CLICKABLE, so it can never
  // block an edit (a click still commits + applies). Grey when the form matches what is already
  // applied to the live graph; the moment the form differs (the top form vs the bottom preview),
  // it goes bright. Read via form.getRawValue() (always the current control value) so it never gets
  // stuck grey after an edit.
  public get submitIdle(): boolean {
    if (this.submitDisabled) {
      return false;
    }
    return !this.hasPendingChanges();
  }

  private hasPendingChanges(): boolean {
    const graph = this.workflowActionService.getTexeraGraph();
    return this.sections.some(section => {
      if (!graph.hasOperator(section.operatorID)) {
        return false;
      }
      const live = graph.getOperator(section.operatorID).operatorProperties;
      const draft = this.templatedWorkflowDraftService.getOperatorProperties(section.operatorID) ?? {};
      const merged = { ...draft, ...section.form.getRawValue() };
      return !isEqual(merged, live);
    });
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

    if (!this.wid) {
      this.notificationService.error("Missing workflow ID.");
      return;
    }

    this.applyJobFormToOperators()
      .pipe(untilDestroyed(this))
      .subscribe({
        next: () => {
          this.showEmbeddedWorkspace = true;
        },
        error: err => {
          console.warn("Failed to update templated workflow", err);
          this.notificationService.error("Failed to update workflow.");
        },
      });
  }

  private applyJobFormToOperators(forceUpdate = false): Observable<Workflow> {
    this.mergeFormValuesIntoOperatorProperties();

    if (!forceUpdate && !this.workflowChanged()) {
      // No-op: the SUBMIT button is already disabled when there is nothing to apply, so this is
      // just a defensive guard -- no notification needed.
      return of(this.workflowActionService.getWorkflow());
    }

    this.writeOperatorPropertiesToGraph();
    const payload = this.getConfigurablePropertyUpdatePayload();

    return this.templatedWorkflowService.updateTemplatedWorkflowProperties(this.wid!, payload).pipe(
      tap(updatedWorkflow => {
        const currentMetadata = this.workflowActionService.getWorkflowMetadata();
        this.workflowActionService.setWorkflowMetadata({
          ...currentMetadata,
          lastModifiedTime: updatedWorkflow.lastModifiedTime,
        });
        this.notificationService.success("Workflow updated.");
      })
    );
  }

  private getConfigurablePropertyUpdatePayload(): {
    operatorProperties: Record<string, Record<string, unknown>>;
  } {
    const operatorProperties: Record<string, Record<string, unknown>> = {};

    for (const section of this.sections) {
      operatorProperties[section.operatorID] = { ...section.model };
    }

    return { operatorProperties };
  }

  private mergeFormValuesIntoOperatorProperties(): void {
    for (const section of this.sections) {
      this.mergeSectionFormValuesIntoOperatorProperties(section);
    }
  }

  private mergeSectionFormValuesIntoOperatorProperties(section: ConfigurableSection): void {
    this.templatedWorkflowDraftService.mergeSectionModel(section.operatorID, section.model);
  }

  private writeOperatorPropertiesToGraph(): void {
    for (const section of this.sections) {
      this.workflowActionService.setOperatorProperty(
        section.operatorID,
        this.templatedWorkflowDraftService.getOperatorProperties(section.operatorID)
      );
    }
  }

  private workflowChanged(): boolean {
    return this.sections.some(section => {
      const liveOperator = this.workflowActionService.getTexeraGraph().getOperator(section.operatorID);

      return this.templatedWorkflowDraftService.operatorPropertiesChanged(
        section.operatorID,
        liveOperator.operatorProperties
      );
    });
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
    this.workflowReady = false;
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
