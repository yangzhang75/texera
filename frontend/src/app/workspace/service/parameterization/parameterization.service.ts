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

import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";
import { CustomJSONSchema7 } from "../../types/custom-json-schema.interface";
import { OperatorPredicate } from "../../types/workflow-common.interface";
import { ParameterBinding, ParameterFieldOverride, ParameterizationConfig } from "../../../common/type/workflow";
import { OperatorMetadataService } from "../operator-metadata/operator-metadata.service";
import { DynamicSchemaService } from "../dynamic-schema/dynamic-schema.service";
import { WorkflowActionService } from "../workflow-graph/model/workflow-action.service";

/** A binding paired with the operator field that renders it. */
export interface ResolvedParameter {
  binding: ParameterBinding;
  /** The operator's current value -- what the form shows and what a run uses. */
  value: unknown;
  /** Label for the operator this input belongs to, for the author's reference. */
  operatorLabel: string;
  schema?: CustomJSONSchema7;
  /**
   * Set when the binding no longer points at a real property, because the operator
   * was deleted on the regular canvas or the raw key was mistyped. Broken inputs are
   * shown to the author with the reason and hidden from everyone else, since filling
   * one in could not do anything.
   */
  brokenReason?: string;
}

/**
 * Reads and writes the Form View definition. The one rule it enforces: a definition never
 * affects a run -- filling an input is the same `setOperatorProperty` edit the canvas makes,
 * and everything else (names, help text, ordering, instruction) is presentation.
 */
@Injectable({ providedIn: "root" })
export class ParameterizationService {
  /** Whether the author is choosing which properties the form offers. Sticky (choosing spans
   *  several operators), so it stays on until the author turns it off. */
  private choosingSubject = new BehaviorSubject<boolean>(false);
  public readonly choosing$: Observable<boolean> = this.choosingSubject.asObservable();

  constructor(
    private workflowActionService: WorkflowActionService,
    private operatorMetadataService: OperatorMetadataService,
    private dynamicSchemaService: DynamicSchemaService
  ) {}

  public isChoosing(): boolean {
    return this.choosingSubject.value;
  }

  public setChoosing(choosing: boolean): void {
    if (this.choosingSubject.value !== choosing) {
      this.choosingSubject.next(choosing);
    }
  }

  public getConfig(): ParameterizationConfig {
    return this.workflowActionService.getParameterization();
  }

  /** Apply a partial edit to the definition, announcing it so it gets saved. */
  public updateConfig(patch: Partial<ParameterizationConfig>): void {
    this.workflowActionService.setParameterization({ ...this.getConfig(), ...patch });
  }

  public setParameters(parameters: ParameterBinding[]): void {
    this.updateConfig({ parameters });
  }

  public updateBinding(id: string, patch: Partial<ParameterBinding>): void {
    this.setParameters(this.getConfig().parameters.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }

  public removeBinding(id: string): void {
    this.setParameters(this.getConfig().parameters.filter(p => p.id !== id));
  }

  /**
   * Expose an operator property, seeding the input from what the operator already
   * holds so the author sees the real value rather than a blank.
   */
  /** The binding for one operator property, if it is currently exposed on the form. */
  private findBinding(operatorID: string, propertyKey: string): ParameterBinding | undefined {
    return this.getConfig().parameters.find(p => p.operatorID === operatorID && p.propertyKey === propertyKey);
  }

  public addBinding(operatorID: string, propertyKey: string): void {
    if (this.findBinding(operatorID, propertyKey)) {
      return;
    }
    const schema = this.propertySchema(operatorID, propertyKey);
    this.setParameters([
      ...this.getConfig().parameters,
      {
        id: `param-${crypto.randomUUID()}`,
        operatorID,
        propertyKey,
        displayName: (schema?.title as string) || propertyKey,
        // Deliberately not seeded from the schema's description. That text describes the
        // operator to whoever wired it up -- "Multiple string key/value pairs" -- and
        // appearing unbidden under a reader's input it is worse than nothing: it reads
        // as guidance the author never wrote and cannot be told apart from guidance
        // they did. Empty until the author has something to say.
        helpText: undefined,
      },
    ]);
  }

  /**
   * Apply an override to one field. An entry that no longer says anything is deleted
   * rather than left as an empty object, so the saved definition stays a record of the
   * author's decisions instead of accumulating every field they happened to look at.
   */
  public setFieldOverride(bindingId: string, path: string, patch: Partial<ParameterFieldOverride>): void {
    const binding = this.getConfig().parameters.find(p => p.id === bindingId);
    if (!binding) {
      return;
    }
    const merged: ParameterFieldOverride = { ...(binding.fields?.[path] ?? {}), ...patch };
    if (merged.displayName !== undefined && merged.displayName.trim() === "") {
      delete merged.displayName;
    }
    if (merged.hidden === false) {
      delete merged.hidden;
    }
    const fields = { ...(binding.fields ?? {}) };
    if (Object.keys(merged).length === 0) {
      delete fields[path];
    } else {
      fields[path] = merged;
    }
    this.updateBinding(bindingId, { fields: Object.keys(fields).length > 0 ? fields : undefined });
  }

  public isExposed(operatorID: string, propertyKey: string): boolean {
    return this.findBinding(operatorID, propertyKey) !== undefined;
  }

  /** Add or remove an input from the form, driven by the property editor's tick box. */
  public setExposed(operatorID: string, propertyKey: string, exposed: boolean): void {
    if (exposed) {
      this.addBinding(operatorID, propertyKey);
      return;
    }
    const existing = this.findBinding(operatorID, propertyKey);
    if (existing) {
      this.removeBinding(existing.id);
    }
  }

  /** Move an input to a new position; array order is what the form renders. */
  public reorder(from: number, to: number): void {
    const parameters = [...this.getConfig().parameters];
    if (from === to || from < 0 || to < 0 || from >= parameters.length || to >= parameters.length) {
      return;
    }
    parameters.splice(to, 0, parameters.splice(from, 1)[0]);
    this.setParameters(parameters);
  }

  /**
   * Choose whether an operator's output is shown on the form after a run.
   *
   * This also marks the operator for result viewing on the graph, because the engine
   * only materialises results for operators in `opsToViewResult` -- picking one here
   * without that produced a run that completed but showed nothing.
   */
  public toggleResultOperator(operatorID: string): void {
    const shown = this.getConfig().resultOperatorIds;
    const next = shown.includes(operatorID) ? shown.filter(id => id !== operatorID) : [...shown, operatorID];
    this.updateConfig({ resultOperatorIds: next });
    this.syncViewResultOperators(next);
  }

  /**
   * Keep the graph's view-result set in step with what the form promises to show.
   * Operators the canvas already views for its own reasons are left alone.
   */
  public syncViewResultOperators(shown: string[] = this.getConfig().resultOperatorIds): void {
    const graph = this.workflowActionService.getTexeraGraph();
    const existing = new Set(graph.getOperatorsToViewResult());
    shown.filter(id => graph.hasOperator(id)).forEach(id => existing.add(id));
    this.workflowActionService.setViewOperatorResults([...existing]);
  }

  // ---------------------------------------------------------------------------
  // Values. These are plain operator-property reads and writes.
  // ---------------------------------------------------------------------------

  public readValue(operatorID: string, propertyKey: string): unknown {
    return this.getOperator(operatorID)?.operatorProperties?.[propertyKey];
  }

  /**
   * Write a filled-in value back to its operator. This is the same edit as changing
   * the property on the regular canvas, which is why both views agree immediately and
   * why a run started from either one behaves identically.
   */
  public writeValue(binding: ParameterBinding, value: unknown): void {
    const operator = this.getOperator(binding.operatorID);
    if (!operator) {
      return;
    }
    this.workflowActionService.setOperatorProperty(binding.operatorID, {
      ...operator.operatorProperties,
      [binding.propertyKey]: value,
    });
  }

  // ---------------------------------------------------------------------------
  // Resolution against the live graph.
  // ---------------------------------------------------------------------------

  /**
   * Pair every binding with its current value and schema, flagging the ones that no
   * longer point anywhere. Callers decide what to do with broken ones: the author sees
   * them so they can be fixed, everyone else does not.
   */
  public resolveParameters(): ResolvedParameter[] {
    return this.getConfig().parameters.map(binding => {
      const operator = this.getOperator(binding.operatorID);
      if (!operator) {
        return {
          binding,
          value: undefined,
          operatorLabel: binding.operatorID,
          brokenReason: "the step it belonged to was removed from the workflow",
        };
      }
      const label = this.operatorLabel(operator);
      const schema = this.propertySchema(binding.operatorID, binding.propertyKey);
      if (!schema) {
        return {
          binding,
          value: undefined,
          operatorLabel: label,
          brokenReason: `"${binding.propertyKey}" is not a setting of ${label}`,
        };
      }
      return {
        binding,
        value: operator.operatorProperties?.[binding.propertyKey],
        operatorLabel: label,
        schema,
      };
    });
  }

  public operatorLabel(operator: OperatorPredicate): string {
    if (operator.customDisplayName?.trim()) {
      return operator.customDisplayName.trim();
    }
    try {
      return this.operatorMetadataService.getOperatorSchema(operator.operatorType).additionalMetadata.userFriendlyName;
    } catch {
      return operator.operatorType;
    }
  }

  private getOperator(operatorID: string): OperatorPredicate | undefined {
    const graph = this.workflowActionService.getTexeraGraph();
    return graph.hasOperator(operatorID) ? graph.getOperator(operatorID) : undefined;
  }

  private operatorSchemaProperties(operatorID: string): Record<string, CustomJSONSchema7> {
    const operator = this.getOperator(operatorID);
    if (!operator) {
      return {};
    }
    // The dynamic schema, not the operator's static one. Schema propagation fills in
    // the list of upstream attribute names, which is what turns an attribute setting
    // into a dropdown; reading the static schema gave the form a bare text box and
    // asked people to type a column name from memory.
    try {
      const jsonSchema = this.dynamicSchemaService.getDynamicSchema(operatorID).jsonSchema;
      return (jsonSchema.properties ?? {}) as Record<string, CustomJSONSchema7>;
    } catch {
      // No dynamic entry yet -- fall back so the form still renders something.
    }
    try {
      const jsonSchema = this.operatorMetadataService.getOperatorSchema(operator.operatorType).jsonSchema;
      return (jsonSchema.properties ?? {}) as Record<string, CustomJSONSchema7>;
    } catch {
      return {};
    }
  }

  private propertySchema(operatorID: string, propertyKey: string): CustomJSONSchema7 | undefined {
    return this.operatorSchemaProperties(operatorID)[propertyKey];
  }
}
