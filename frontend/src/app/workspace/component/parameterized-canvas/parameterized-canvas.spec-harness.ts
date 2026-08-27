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

import { of, Subject } from "rxjs";
import { vi } from "vitest";

import { ResolvedParameter } from "../../service/parameterization/parameterization.service";

/** A binding for one operator property, keyed by id. */
export const binding = (id: string, displayName: string) => ({
  id,
  operatorID: "op-1",
  propertyKey: id,
  displayName,
});

/** A resolved (non-broken) parameter, ready to render. Override `binding`/`brokenReason` per test. */
export const resolved = (id: string, displayName: string, extra: Partial<ResolvedParameter> = {}): ResolvedParameter => ({
  binding: binding(id, displayName),
  value: "seed",
  operatorLabel: "Source: Scan",
  schema: { type: "string" } as any,
  ...extra,
});

/** The workflow every test opens by default: parameterized, writable, empty content. */
export const parameterized = { name: "scGPT", isParameterized: true, readonly: false, content: {} };

/**
 * Mocks and streams shared by every parameterized-canvas spec, plus the component factory. Streams and
 * collections are created once per `setupHarness()` (called from each `beforeEach`), so the aliases
 * a spec captures stay valid across a test; `build(workflow)` only constructs the component.
 */
export function setupHarness() {
  const executionStateStream = new Subject<any>();
  const modificationEnabled = new Subject<boolean>();
  const compilationChanged = new Subject<unknown>();
  const durationEvents = new Subject<{ duration: number; isRunning: boolean }>();
  const highlightStream = new Subject<readonly string[]>();
  const unhighlightStream = new Subject<readonly string[]>();
  const resultUpdateStream = new Subject<unknown>();
  const workflowChangedStream = new Subject<unknown>();
  const highlightedIds: string[] = [];
  const graphOperators: any[] = [];
  const hasOperatorIds = new Set<string>();
  const anyResultIds = new Set<string>();
  const router = { navigate: vi.fn() };
  // The selected computing unit, read through the status-service mock. `setComputingUnit` lets a
  // test drop it (the no-unit case) without breaking the mock's closure.
  let computingUnit: unknown = { computingUnit: { cuid: 1 }, status: "Running" };

  const executeWorkflowService = {
    getExecutionStateStream: () => executionStateStream.asObservable(),
    executeWorkflow: vi.fn(),
    killWorkflow: vi.fn(),
    resetExecutionAndWorkers: vi.fn(),
  };
  const parameterizationService = {
    getConfig: vi.fn().mockReturnValue({ parameters: [], resultOperatorIds: [] }),
    resolveParameters: vi.fn().mockReturnValue([]),
    writeValue: vi.fn(),
    operatorLabel: vi.fn().mockReturnValue("Source: Scan"),
    // The engine only materialises results for operators the graph views, so the
    // component keeps that set in step with what the form promises to show.
    syncViewResultOperators: vi.fn(),
    updateBinding: vi.fn(),
    setFieldOverride: vi.fn(),
    setParameters: vi.fn(),
    removeBinding: vi.fn(),
    reorder: vi.fn(),
    toggleResultOperator: vi.fn(),
    updateConfig: vi.fn(),
    readValue: vi.fn().mockReturnValue(undefined),
  };
  const workflowPersistService = {
    retrieveWorkflow: vi.fn().mockReturnValue(of(parameterized)),
    isWorkflowPersistEnabled: () => false,
    persistWorkflow: vi.fn().mockReturnValue(of(parameterized)),
  };
  const workflowActionService = {
    resetAsNewWorkflow: vi.fn(),
    setHighlightingEnabled: vi.fn(),
    setNewSharedModel: vi.fn(),
    reloadWorkflow: vi.fn(),
    disableWorkflowModification: vi.fn(),
    enableWorkflowModification: vi.fn(),
    // A finished run re-enables modification for the operator canvas's sake, so this
    // page watches the stream and locks the graph straight back down.
    getWorkflowModificationEnabledStream: () => modificationEnabled.asObservable(),
    clearWorkflow: vi.fn(),
    workflowChanged: () => workflowChangedStream.asObservable(),
    getWorkflow: vi.fn(),
    getWorkflowMetadata: () => ({ name: "scGPT", lastModifiedTime: 1767225600000 }),
    setWorkflowName: vi.fn(),
    getTexeraGraph: () => ({
      getAllOperators: () => graphOperators,
      getOperator: (id: string) => graphOperators.find(o => o.operatorID === id),
      triggerCenterEvent: vi.fn(),
      hasOperator: (id: string) => hasOperatorIds.has(id),
      updateSharedModelAwareness: vi.fn(),
    }),
    getJointGraphWrapper: () => ({
      getJointOperatorHighlightStream: () => highlightStream.asObservable(),
      getJointOperatorUnhighlightStream: () => unhighlightStream.asObservable(),
      getCurrentHighlightedOperatorIDs: () => highlightedIds,
      unhighlightOperators: vi.fn(),
    }),
    parameterizationChanged$: new Subject<unknown>(),
  };

  // The remaining constructor dependencies, as named mocks so each slice's spec can pass the
  // exact subset its component's constructor takes.
  const coeditorPresenceService = { coeditors: [] };
  const route = { snapshot: { params: { id: "7" } } };
  const operatorMetadataService = { getOperatorMetadata: () => of({}) };
  const workflowResultService = {
    hasAnyResult: (id: string) => anyResultIds.has(id),
    clearResults: vi.fn(),
    hasPaginatedResult: (id: string) => id === "tabular",
    getResultUpdateStream: () => resultUpdateStream.asObservable(),
    getResultService: () => undefined,
  };
  const notificationService = { error: vi.fn() };
  const userService = { getCurrentUser: () => undefined, isLogin: () => false };
  const markdownService = { parse: (s: string) => s };
  // A field per property the tests expose, plus a file field (drives the map callback) and an
  // array-of-objects property whose row template is a function (drives the override walk).
  const formlyJsonschema = {
    toFieldConfig: (_schema: any, opts: any) => {
      const fields = [
        { key: "n_hvg", props: { label: "N" } },
        { key: "tableName", props: { label: "table name" } },
        { key: "fileName", props: { label: "File" } },
        {
          key: "predicates",
          props: { label: "Predicates" },
          fieldArray: () => ({ fieldGroup: [{ key: "alias", props: { label: "Alias" } }] }),
        },
        { key: "nested", props: { label: "Nested" }, fieldGroup: [{ key: "sub", props: { label: "Sub" } }] },
      ];
      return { fieldGroup: opts?.map ? fields.map(opts.map) : fields };
    },
  };
  const cdr = { detectChanges: vi.fn(), markForCheck: vi.fn() };
  const dynamicSchemaService = { getDynamicSchema: () => ({ jsonSchema: {} }) };
  const workflowCompilingService = {
    getCompilationStateInfoChangedStream: () => compilationChanged.asObservable(),
  };
  const computingUnitStatusService = {
    disconnect: vi.fn(),
    getSelectedComputingUnitValue: () => computingUnit,
    getSelectedComputingUnit: () => of(computingUnit),
    getStatus: () => of("Running"),
    selectComputingUnit: vi.fn(),
  };
  const workflowConsoleService = { clearConsoleMessages: vi.fn() };
  const workflowWebsocketService = {
    isConnected: true,
    subscribeToEvent: () => durationEvents.asObservable(),
    getConnectionStatusStream: () => of(true),
  };
  const host = { nativeElement: { querySelectorAll: () => [], querySelector: () => null, contains: () => false } };
  const datePipe = { transform: () => "01/01/2026 00:00:00" };
  const panelResizeService = { changePanelSize: vi.fn() };
  const validationWorkflowService = {
    getWorkflowValidationErrorStream: () => of({ workflowEmpty: false, errors: {} }),
  };
  const config = { env: { formViewEnabled: true } };

  // Point the persist mocks at `workflow`; each slice's spec supplies the remaining constructor
  // arguments in its own (trimmed) order via the named mocks above.
  const useWorkflow = (workflow: any) => {
    workflowPersistService.retrieveWorkflow.mockReturnValue(of(workflow));
    workflowPersistService.persistWorkflow.mockReturnValue(of(workflow));
  };

  return {
    useWorkflow,
    router,
    coeditorPresenceService,
    route,
    workflowActionService,
    workflowPersistService,
    operatorMetadataService,
    parameterizationService,
    executeWorkflowService,
    workflowResultService,
    notificationService,
    userService,
    markdownService,
    formlyJsonschema,
    cdr,
    dynamicSchemaService,
    workflowCompilingService,
    computingUnitStatusService,
    workflowConsoleService,
    workflowWebsocketService,
    host,
    datePipe,
    panelResizeService,
    validationWorkflowService,
    config,
    executionStateStream,
    modificationEnabled,
    compilationChanged,
    durationEvents,
    highlightStream,
    unhighlightStream,
    resultUpdateStream,
    workflowChangedStream,
    highlightedIds,
    graphOperators,
    hasOperatorIds,
    anyResultIds,
    setComputingUnit: (value: unknown) => (computingUnit = value),
  };
}
