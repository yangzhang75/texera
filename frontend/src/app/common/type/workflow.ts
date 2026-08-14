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

import { WorkflowMetadata } from "../../dashboard/type/workflow-metadata.interface";
import { CommentBox, OperatorLink, OperatorPredicate, Point } from "../../workspace/types/workflow-common.interface";

export enum ExecutionMode {
  PIPELINED = "PIPELINED",
  MATERIALIZED = "MATERIALIZED",
}

export interface WorkflowSettings {
  dataTransferBatchSize: number;
  executionMode: ExecutionMode;
}

/**
 * One input exposed on the Parameterized Canvas.
 *
 * A binding points at a single property of a single operator. The operator's own
 * property is always the live value -- filling the form is exactly the same edit as
 * changing that property on the regular canvas -- while the fields here only decide
 * how the input is presented.
 *
 * `id` is a stable identity that survives renaming the input or repointing it at a
 * different property, so reordering and removal never depend on the raw key.
 */
export interface ParameterBinding {
  id: string;
  operatorID: string;
  /** The operator property this input writes to. Editable, and validated against the operator's schema. */
  propertyKey: string;
  displayName: string;
  helpText?: string;
  /** What "Reset" restores. May be absent, meaning the input starts empty. */
  defaultValue?: unknown;
  /**
   * Per-field overrides inside this input, keyed by the field's path within the
   * property (`fileKey`, `alias`, `predicates.0.value` -- the array index is dropped,
   * so `predicates.value` covers every row).
   *
   * A property is rarely a single box: an array of objects puts several fields in front
   * of the reader, each labelled by whatever the operator's schema happens to call it.
   * The author decides what a reader sees and what it is called; the schema's own label
   * is only the default. An entry is present only where the author changed something,
   * so an untouched form carries nothing.
   */
  fields?: { [path: string]: ParameterFieldOverride };
}

export interface ParameterFieldOverride {
  /** Kept out of the reader's form. The value the author set still applies. */
  hidden?: boolean;
  /** Replaces the schema's label. Empty or absent keeps the schema's own. */
  displayName?: string;
}

/**
 * How a workflow presents itself on the Parameterized Canvas.
 *
 * Deliberately excludes an on/off flag: whether the canvas is offered at all lives in
 * `workflow.is_parameterized`, so there is exactly one source of truth for it and the
 * two can never disagree. Turning it off leaves this definition intact.
 *
 * Nothing in here may affect execution. A run reads operator properties and the graph
 * only, so a workflow whose parameterization is missing or stale still runs normally
 * on the regular canvas.
 */
export interface ParameterizationConfig {
  instruction?: {
    /** Optional -- an empty title hides the heading rather than showing a placeholder. */
    title?: string;
    /** Markdown. */
    body: string;
  };
  /** Array order is display order; the author reorders by dragging. */
  parameters: ParameterBinding[];
  /** Operators whose results are shown under the workflow after a run. */
  resultOperatorIds: string[];
  /**
   * Optional one-line explanation per shown result, keyed by operator id. A table of
   * numbers rarely says what it is; this lets the author say so. Absent means no note.
   */
  resultNotes?: { [operatorID: string]: string };
}

export function getDefaultParameterization(): ParameterizationConfig {
  return { parameters: [], resultOperatorIds: [] };
}

/**
 * WorkflowContent is used to store the information of the workflow
 *  1. all existing operators and their properties
 *  2. operator's position on the JointJS paper
 *  3. operator link predicates
 *
 * When the user refreshes the browser, the CachedWorkflow interface will be
 *  automatically cached and loaded once the refresh completes. This information
 *  will then be used to reload the entire workflow.
 *
 */

export interface WorkflowContent
  extends Readonly<{
    operators: OperatorPredicate[];
    operatorPositions: { [key: string]: Point };
    links: OperatorLink[];
    commentBoxes: CommentBox[];
    settings: WorkflowSettings;
    /**
     * Present once an author has set up the Parameterized Canvas. Like `settings`,
     * this rides in the content rather than the shared graph, so it is saved, cloned,
     * versioned and published with the workflow at no extra cost.
     */
    parameterization?: ParameterizationConfig;
  }> {}

export type Workflow = { content: WorkflowContent } & WorkflowMetadata;
