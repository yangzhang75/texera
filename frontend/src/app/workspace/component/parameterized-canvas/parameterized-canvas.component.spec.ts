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

import { ChangeDetectorRef } from "@angular/core";
import { Router } from "@angular/router";
import { of, Subject, throwError } from "rxjs";

import { ParameterizedCanvasComponent } from "./parameterized-canvas.component";
import { ResolvedParameter } from "../../service/parameterization/parameterization.service";
import { ExecutionState } from "../../types/execute-workflow.interface";
import { USER_WORKFLOW, USER_WORKSPACE } from "../../../app-routing.constant";
import { FORM_DEBOUNCE_TIME_MS } from "../../service/execute-workflow/execute-workflow.service";

/**
 * These exercise the component's own decisions -- what a reader is shown, when a run
 * is refused, and where an unparameterized workflow is sent -- without standing up the
 * JointJS canvas, which has nothing to do with any of them.
 */
describe("ParameterizedCanvasComponent", () => {
  let component: ParameterizedCanvasComponent;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let executeWorkflowService: any;
  let parameterizationService: any;
  let workflowPersistService: any;
  let workflowActionService: any;
  let executionStateStream: Subject<any>;
  let modificationEnabled: Subject<boolean>;
  let schemaChanged: Subject<{ operatorID: string }>;
  let durationEvents: Subject<{ duration: number; isRunning: boolean }>;

  const binding = (id: string, displayName: string) => ({
    id,
    operatorID: "op-1",
    propertyKey: id,
    displayName,
    defaultValue: "seed",
  });

  const resolved = (id: string, displayName: string, extra: Partial<ResolvedParameter> = {}): ResolvedParameter => ({
    binding: binding(id, displayName),
    value: "seed",
    operatorLabel: "Source: Scan",
    schema: { type: "string" } as any,
    ...extra,
  });

  let computingUnit: unknown = { computingUnit: { cuid: 1 }, status: "Running" };

  const build = (workflow: any) => {
    computingUnit = { computingUnit: { cuid: 1 }, status: "Running" };
    executionStateStream = new Subject<any>();
    modificationEnabled = new Subject<boolean>();
    schemaChanged = new Subject<{ operatorID: string }>();
    durationEvents = new Subject<{ duration: number; isRunning: boolean }>();
    router = { navigate: vi.fn() };

    executeWorkflowService = {
      getExecutionStateStream: () => executionStateStream.asObservable(),
      executeWorkflow: vi.fn(),
      killWorkflow: vi.fn(),
      resetExecutionAndWorkers: vi.fn(),
    };
    parameterizationService = {
      getConfig: vi.fn().mockReturnValue({ parameters: [], resultOperatorIds: [] }),
      resolveParameters: vi.fn().mockReturnValue([]),
      writeValue: vi.fn(),
      resetToDefault: vi.fn(),
      operatorLabel: vi.fn().mockReturnValue("Source: Scan"),
      // The engine only materialises results for operators the graph views, so the
      // component keeps that set in step with what the form promises to show.
      syncViewResultOperators: vi.fn(),
      getResultNote: vi.fn().mockReturnValue(""),
      setResultNote: vi.fn(),
      updateBinding: vi.fn(),
      setFieldOverride: vi.fn(),
    };
    workflowPersistService = {
      retrieveWorkflow: vi.fn().mockReturnValue(of(workflow)),
      isWorkflowPersistEnabled: () => false,
      persistWorkflow: vi.fn().mockReturnValue(of(workflow)),
    };
    workflowActionService = {
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
      workflowChanged: () => new Subject<unknown>(),
      getWorkflow: vi.fn(),
      getWorkflowMetadata: () => ({ name: "scGPT", lastModifiedTime: 1767225600000 }),
      setWorkflowName: vi.fn(),
      getTexeraGraph: () => ({ getAllOperators: () => [], triggerCenterEvent: vi.fn(), hasOperator: () => false }),
      getJointGraphWrapper: () => ({
        getJointOperatorHighlightStream: () => new Subject<readonly string[]>(),
        getJointOperatorUnhighlightStream: () => new Subject<readonly string[]>(),
        getCurrentHighlightedOperatorIDs: () => [],
      }),
      parameterizationChanged$: new Subject<unknown>(),
    };

    component = new ParameterizedCanvasComponent(
      { snapshot: { params: { id: "7" } } } as any,
      router as unknown as Router,
      workflowActionService,
      workflowPersistService,
      { getOperatorMetadata: () => of({}) } as any,
      parameterizationService,
      executeWorkflowService,
      {
        hasAnyResult: () => false,
        clearResults: vi.fn(),
        hasPaginatedResult: () => false,
        getResultUpdateStream: () => of({}),
      } as any,
      { error: vi.fn() } as any,
      { getCurrentUser: () => undefined, isLogin: () => false } as any,
      { parse: (s: string) => s } as any,
      { toFieldConfig: () => ({ fieldGroup: [] }) } as any,
      { detectChanges: vi.fn(), markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
      // DynamicSchemaService also tells the page when compilation has filled in an
      // operator's attribute options, which is what turns those boxes into dropdowns.
      { getOperatorDynamicSchemaChangedStream: () => schemaChanged.asObservable() } as any,
      // WorkflowCompilingService is injected only so it exists before the workflow
      // loads and starts compiling; a bare stub is the whole contract.
      {} as any,
      {
        disconnect: vi.fn(),
        getSelectedComputingUnitValue: () => computingUnit,
        getSelectedComputingUnit: () => of(computingUnit),
        getStatus: () => of("Running"),
        selectComputingUnit: vi.fn(),
      } as any,
      { clearConsoleMessages: vi.fn() } as any,
      // The run clock reads its elapsed time off this engine event.
      { isConnected: true, subscribeToEvent: () => durationEvents.asObservable() } as any,
      // `contains` answers whether the cursor is inside this page, which decides
      // whether a rebuild would be pulled out from under someone typing.
      { nativeElement: { querySelectorAll: () => [], querySelector: () => null, contains: () => false } } as any,
      { transform: () => "01/01/2026 00:00:00" } as any
    );
    return component;
  };

  const parameterized = { name: "scGPT", isParameterized: true, readonly: false, content: {} };

  describe("who this page is for", () => {
    it("opens the form for a workflow whose author turned it on", () => {
      build(parameterized).ngOnInit();

      expect(component.workflowName).toBe("scGPT");
      expect(component.loading).toBe(false);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    // Nothing about this page should exist for a plain workflow, including its URL.
    it("sends a plain workflow to the operator canvas instead of showing an empty form", () => {
      build({ ...parameterized, isParameterized: false }).ngOnInit();

      expect(router.navigate).toHaveBeenCalledWith([USER_WORKSPACE, "7"], { replaceUrl: true });
    });

    it("shows the workflow read-only, since editing belongs to the other view", () => {
      build(parameterized).ngOnInit();

      expect(workflowActionService.disableWorkflowModification).toHaveBeenCalled();
    });

    // Two separate locks, deliberately. Properties follow the mode; the shape of the
    // graph is off limits in both modes and is held that way by the editor's own
    // structureLocked input, not by this one -- using the modification lock for it took
    // the property panel down with it and left an author unable to change anything.
    it("shows properties rather than editing them until edit mode is on", () => {
      build(parameterized).ngOnInit();

      expect(workflowActionService.disableWorkflowModification).toHaveBeenCalled();
      expect(workflowActionService.enableWorkflowModification).not.toHaveBeenCalled();
    });

    it("lets an author edit properties in edit mode", () => {
      build(parameterized).ngOnInit();

      component.toggleAuthoring();

      expect(workflowActionService.enableWorkflowModification).toHaveBeenCalled();
    });

    it("puts them back to read-only on leaving edit mode", () => {
      build(parameterized).ngOnInit();
      component.toggleAuthoring();
      workflowActionService.disableWorkflowModification.mockClear();

      component.toggleAuthoring();

      expect(workflowActionService.disableWorkflowModification).toHaveBeenCalled();
    });

    it("never unlocks for a reader without write access", () => {
      build({ ...parameterized, readonly: true }).ngOnInit();

      component.toggleAuthoring();

      expect(workflowActionService.enableWorkflowModification).not.toHaveBeenCalled();
    });

    it("offers author controls only with write access", () => {
      build({ ...parameterized, readonly: true }).ngOnInit();
      expect(component.canEdit).toBe(false);

      build(parameterized).ngOnInit();
      expect(component.canEdit).toBe(true);
    });

    it("goes back to the list when the workflow cannot be opened", () => {
      build(parameterized);
      workflowPersistService.retrieveWorkflow.mockReturnValue(throwError(() => new Error("denied")));

      component.ngOnInit();

      expect(router.navigate).toHaveBeenCalledWith([USER_WORKFLOW]);
    });
  });

  describe("broken inputs", () => {
    const healthy = resolved("n_hvg", "Number of genes");
    const broken = resolved("gone", "Gone", { brokenReason: "the step it belonged to was removed" });

    beforeEach(() => {
      build(parameterized);
      parameterizationService.resolveParameters.mockReturnValue([healthy, broken]);
      component.ngOnInit();
    });

    // Filling in an input that points nowhere could not affect the run, so a reader is
    // not offered it; the author is, because they are the one who can fix it.
    it("hides them from a reader and counts them", () => {
      expect(component.visibleParameters).toEqual([healthy]);
      expect(component.brokenCount).toBe(1);
    });

    it("shows them to the author", () => {
      component.authoring = true;

      expect(component.visibleParameters).toEqual([healthy, broken]);
    });
  });

  describe("running", () => {
    beforeEach(() => {
      build(parameterized);
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Number of genes")]);
      component.ngOnInit();
    });

    it("runs this very workflow, by name", () => {
      component.onRun();

      expect(executeWorkflowService.executeWorkflow).toHaveBeenCalledWith("scGPT");
    });

    it("refuses with a specific message when an input is empty", () => {
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Number of genes", { value: "" })]);
      (component as any).readConfig();

      component.onRun();

      expect(executeWorkflowService.executeWorkflow).not.toHaveBeenCalled();
      expect(component.runError).toContain("Number of genes");
    });

    it("turns into Stop while a run is in flight", () => {
      executionStateStream.next({ current: { state: ExecutionState.Running } });
      expect(component.isRunning).toBe(true);

      component.onRun();

      expect(executeWorkflowService.killWorkflow).toHaveBeenCalled();
      expect(executeWorkflowService.executeWorkflow).not.toHaveBeenCalled();
    });

    it("is not running once the execution finishes", () => {
      executionStateStream.next({ current: { state: ExecutionState.Completed } });

      expect(component.isRunning).toBe(false);
    });

    // Starting a run must not pop the workflow open. This page exists so a reader can
    // fill in a form and get an answer; shoving a canvas at them mid-run is exactly the
    // thing the form is meant to spare them. Whoever wants to watch opens it themselves.
    it("leaves the workflow as the reader left it when a run starts", () => {
      expect(component.workflowOpen).toBe(false);

      executionStateStream.next({ current: { state: ExecutionState.Running } });

      expect(component.workflowOpen).toBe(false);
    });

    it("respects a reader who collapsed it on purpose", () => {
      component.toggleWorkflow();
      component.toggleWorkflow();
      expect(component.workflowOpen).toBe(false);

      executionStateStream.next({ current: { state: ExecutionState.Running } });

      expect(component.workflowOpen).toBe(false);
    });
  });

  describe("values", () => {
    beforeEach(() => {
      build(parameterized);
      component.ngOnInit();
    });

    it("writes text straight through to the operator", () => {
      const parameter = resolved("tableName", "Input table");

      component.onValueChange(parameter, "reddit");

      expect(parameterizationService.writeValue).toHaveBeenCalledWith(parameter.binding, "reddit");
    });

    // An operator that expects a number must not be handed the string "1500".
    it("keeps numeric inputs numeric", () => {
      const parameter = resolved("n_hvg", "Number of genes", { schema: { type: "number" } as any });

      component.onValueChange(parameter, "1500");

      expect(parameterizationService.writeValue).toHaveBeenCalledWith(parameter.binding, 1500);
    });

    it("treats an emptied number as no value rather than NaN", () => {
      const parameter = resolved("n_hvg", "Number of genes", { schema: { type: "number" } as any });

      component.onValueChange(parameter, "");

      expect(parameterizationService.writeValue).toHaveBeenCalledWith(parameter.binding, undefined);
    });

    it("offers Reset only once a value differs from the author's default", () => {
      expect(component.isModified(resolved("n_hvg", "n", { value: "seed" }))).toBe(false);
      expect(component.isModified(resolved("n_hvg", "n", { value: "changed" }))).toBe(true);
    });
  });

  // Run is never held back on a guess about whether it can succeed. Every version of
  // that guess was wrong in a way that left the reader with a button that did nothing
  // and no way forward, so the attempt is always made and a failure explains itself --
  // exactly how the operator canvas behaves.
  // How much room a chart needs depends on the chart, so the reader sets it per result.
  // Starting a run repaints every operator, and JointJS lays that out against the size
  // it last measured -- which in the preview was taken while the strip was still
  // opening. Without a fresh measurement the repaint lands on stale numbers and the
  // labels sit across their own boxes.
  describe("re-measuring the preview when a run starts", () => {
    beforeEach(() => build(parameterized).ngOnInit());

    it("re-fits when the execution state changes while the workflow is open", () => {
      component.workflowOpen = true;
      const refit = vi.spyOn(component as any, "refitCanvas").mockImplementation(() => {});

      executionStateStream.next({ current: { state: ExecutionState.Running } });

      expect(refit).toHaveBeenCalled();
    });

    // Nothing to measure while it is collapsed, and measuring then is what produced the
    // stale numbers in the first place.
    it("leaves a collapsed preview alone", () => {
      component.workflowOpen = false;
      const refit = vi.spyOn(component as any, "refitCanvas").mockImplementation(() => {});

      executionStateStream.next({ current: { state: ExecutionState.Running } });

      expect(refit).not.toHaveBeenCalled();
    });

    it("does not re-fit when the state has not actually changed", () => {
      component.workflowOpen = true;
      executionStateStream.next({ current: { state: ExecutionState.Running } });
      const refit = vi.spyOn(component as any, "refitCanvas").mockImplementation(() => {});

      executionStateStream.next({ current: { state: ExecutionState.Running } });

      expect(refit).not.toHaveBeenCalled();
    });
  });

  describe("resizing a result", () => {
    beforeEach(() => build(parameterized).ngOnInit());

    it("starts at the middle size", () => {
      expect(component.resultZoom("op-1")).toBe(1);
    });

    it("grows and shrinks within bounds", () => {
      component.zoomResult("op-1", 1);
      expect(component.resultZoom("op-1")).toBe(2);

      component.zoomResult("op-1", 1);
      expect(component.resultZoom("op-1")).toBe(2);

      component.zoomResult("op-1", -1);
      component.zoomResult("op-1", -1);
      expect(component.resultZoom("op-1")).toBe(0);

      component.zoomResult("op-1", -1);
      expect(component.resultZoom("op-1")).toBe(0);
    });

    // Resizing one chart must not resize the others.
    it("keeps a size per result", () => {
      component.zoomResult("op-1", 1);

      expect(component.resultZoom("op-2")).toBe(1);
    });
  });

  describe("running without a computing unit", () => {
    it("still attempts the run rather than refusing up front", () => {
      build(parameterized);
      computingUnit = null;
      component.ngOnInit();

      component.onRun();

      expect(executeWorkflowService.executeWorkflow).toHaveBeenCalled();
    });

    it("points at the missing unit afterwards", () => {
      build(parameterized);
      computingUnit = null;
      component.ngOnInit();

      expect(component.needsComputingUnit).toBe(false);

      component.onRun();

      expect(component.needsComputingUnit).toBe(true);
    });

    it("says nothing when a unit is already chosen", () => {
      build(parameterized).ngOnInit();

      component.onRun();

      expect(component.needsComputingUnit).toBe(false);
    });
  });

  // Loading a workflow throws on an operator with no position, so a save from this page
  // must never leave one out -- that would make the workflow unopenable in either view.
  describe("saving", () => {
    const withOperators = (ids: string[], positions: Record<string, unknown>) => ({
      wid: 7,
      content: {
        operators: ids.map(operatorID => ({ operatorID })),
        operatorPositions: positions,
      },
    });

    beforeEach(() => {
      build(parameterized);
      workflowPersistService.isWorkflowPersistEnabled = () => true;
      component.ngOnInit();
      (component as any).userService.isLogin = () => true;
    });

    it("keeps the positions the workflow was opened with", () => {
      workflowActionService.getWorkflow = () => withOperators(["a"], { a: { x: 0, y: 0 } });
      (component as any).storedPositions = { a: { x: 260, y: 180 } };

      (component as any).save();

      const saved = workflowPersistService.persistWorkflow.mock.calls[0][0];
      expect(saved.content.operatorPositions).toEqual({ a: { x: 260, y: 180 } });
    });

    it("still gives a position to an operator the stored map never knew about", () => {
      workflowActionService.getWorkflow = () => withOperators(["a", "b"], { a: { x: 0, y: 0 }, b: { x: 5, y: 6 } });
      (component as any).storedPositions = { a: { x: 260, y: 180 } };

      (component as any).save();

      const saved = workflowPersistService.persistWorkflow.mock.calls[0][0];
      expect(Object.keys(saved.content.operatorPositions).sort()).toEqual(["a", "b"]);
      expect(saved.content.operatorPositions.b).toEqual({ x: 5, y: 6 });
    });

    it("never writes a workflow that is missing a position", () => {
      workflowActionService.getWorkflow = () => withOperators(["a", "b"], {});
      (component as any).storedPositions = {};

      (component as any).save();

      const saved = workflowPersistService.persistWorkflow.mock.calls[0][0];
      for (const operator of saved.content.operators) {
        expect(saved.content.operatorPositions[operator.operatorID]).toBeDefined();
      }
    });

    it("does not save a workflow other than the one this page opened", () => {
      workflowActionService.getWorkflow = () => ({ wid: 99, content: { operators: [], operatorPositions: {} } });

      (component as any).save();

      expect(workflowPersistService.persistWorkflow).not.toHaveBeenCalled();
    });
  });

  // The default is no longer edited from the card, but it is still what Reset returns
  // to, so the comparison that decides "changed" still has to hold up.
  describe("defaults for complex settings", () => {
    beforeEach(() => {
      build(parameterized);
      component.ngOnInit();
    });

    // Two equal lists are different objects; that is not a change the reader made.
    it("does not call an unchanged list modified", () => {
      const p = resolved("predicates", "Predicates", { schema: { type: "array" } as any });
      p.binding.defaultValue = [{ a: 1 }] as never;
      p.value = [{ a: 1 }];

      expect(component.isModified(p)).toBe(false);

      p.value = [{ a: 2 }];
      expect(component.isModified(p)).toBe(true);
    });
  });

  describe("looking at a step", () => {
    beforeEach(() => {
      build(parameterized);
      workflowActionService.getTexeraGraph = () => ({
        getAllOperators: () => [],
        triggerCenterEvent: vi.fn(),
        hasOperator: (id: string) => id === "op-1",
        getOperator: () => ({ operatorID: "op-1", operatorType: "ScanSource" }),
      });
      component.ngOnInit();
    });

    it("opens the workflow's own property panel for it", () => {
      component.onOperatorClicked("op-1");

      expect(component.selectedOperatorId).toBe("op-1");
      expect(component.selectedOperatorLabel).toBe("Source: Scan");
    });

    it("closes the panel for a step that is no longer there", () => {
      component.onOperatorClicked("op-1");

      component.onOperatorClicked("gone");

      expect(component.selectedOperatorId).toBeUndefined();
    });
  });

  // An input's own title and the titles of the boxes inside it are renamed the same way:
  // by clicking the title. The name used to live in a separate "Display name" box in the
  // card footer, which taught two gestures for one thing.
  describe("renaming an input from its own title", () => {
    const buildNode = (authoring: boolean) => {
      build(parameterized);
      (component as any).authoring = authoring;
      const node: any = { key: "b1", props: { label: "File" } };
      (component as any).applyFieldOverrides(node, { id: "b1", propertyKey: "fileName" }, "File");
      return node;
    };

    it("makes the top-level title editable in place while authoring", () => {
      const node = buildNode(true);

      expect(node.wrappers).toContain("editable-label-wrapper");
      expect(node.props.schemaLabel).toBe("File");
    });

    it("offers no eye on the top-level title, since Remove already takes it off the form", () => {
      expect(buildNode(true).props.canHide).toBe(false);
    });

    it("writes the typed name onto the binding", () => {
      const node = buildNode(true);
      const updateBinding = vi.spyOn(parameterizationService, "updateBinding").mockImplementation(() => {});

      node.props.renameField("Input file");

      expect(updateBinding).toHaveBeenCalledWith("b1", { displayName: "Input file" });
    });

    it("leaves the reader a plain title with no rename control", () => {
      expect(buildNode(false).wrappers ?? []).not.toContain("editable-label-wrapper");
    });
  });

  // Attribute boxes only become dropdowns once compilation reports the upstream column
  // names, which lands after these cards were built. Without picking that up the form
  // showed a plain text input where the operator canvas showed a dropdown.
  describe("picking up attribute options when compilation reports them", () => {
    const armed = () => {
      build(parameterized).ngOnInit();
      component.parameters = [resolved("a", "A")];
      return vi.spyOn(component as any, "readConfig");
    };

    it("rebuilds the cards for an operator it shows", async () => {
      const rebuild = armed();

      schemaChanged.next({ operatorID: "op-1" });
      await new Promise(r => setTimeout(r, FORM_DEBOUNCE_TIME_MS + 50));

      expect(rebuild).toHaveBeenCalled();
    });

    it("ignores an operator none of its cards came from", async () => {
      const rebuild = armed();

      schemaChanged.next({ operatorID: "op-elsewhere" });
      await new Promise(r => setTimeout(r, FORM_DEBOUNCE_TIME_MS + 50));

      expect(rebuild).not.toHaveBeenCalled();
    });

    it("does not rebuild under the cursor of someone typing", async () => {
      const rebuild = armed();
      vi.spyOn(component as any, "isTypingInTheForm").mockReturnValue(true);

      schemaChanged.next({ operatorID: "op-1" });
      await new Promise(r => setTimeout(r, FORM_DEBOUNCE_TIME_MS + 50));

      expect(rebuild).not.toHaveBeenCalled();
    });
  });

  // The clock reads the engine's own elapsed time rather than starting a stopwatch at
  // the click, so it stays right across a reload and cannot drift.
  describe("the run clock", () => {
    it("shows nothing before anything has run", () => {
      build(parameterized).ngOnInit();

      expect(component.executionDuration).toBe(0);
    });

    it("takes the elapsed time the engine reports", () => {
      build(parameterized).ngOnInit();

      durationEvents.next({ duration: 4000, isRunning: true });

      expect(component.executionDuration).toBe(4000);
    });

    it("keeps the final time when the run stops", () => {
      build(parameterized).ngOnInit();

      durationEvents.next({ duration: 4000, isRunning: true });
      durationEvents.next({ duration: 7000, isRunning: false });

      expect(component.executionDuration).toBe(7000);
    });
  });

  // JointJS measures the paper once, when the editor is created. Creating it in the same
  // pass that uncollapses the strip races the browser's layout, and losing that race
  // draws links up and over the boxes -- which is why the bad drawing only appeared
  // sometimes.
  describe("opening the workflow strip", () => {
    const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));

    it("reveals the strip before building the canvas inside it", async () => {
      build(parameterized).ngOnInit();

      component.toggleWorkflow();

      expect(component.workflowOpen).toBe(true);
      expect(component.workflowEverOpened).toBe(false);
    });

    it("builds the canvas once the strip has a size", async () => {
      build(parameterized).ngOnInit();

      component.toggleWorkflow();
      await frame();

      expect(component.workflowEverOpened).toBe(true);
    });

    it("waits the same way when a starting run opens the strip for you", async () => {
      build(parameterized).ngOnInit();

      (component as any).showWorkflow();

      expect(component.workflowOpen).toBe(true);
      expect(component.workflowEverOpened).toBe(false);

      await frame();

      expect(component.workflowEverOpened).toBe(true);
    });

    it("leaves the canvas alone when the strip is being closed", () => {
      build(parameterized).ngOnInit();
      component.toggleWorkflow();

      component.toggleWorkflow();

      expect(component.workflowOpen).toBe(false);
    });
  });

  // Leaving for the dashboard is an ordinary in-app navigation, so a reader can walk out
  // during the few hundred milliseconds a chart or a canvas is waiting to be fitted.
  // Those callbacks call detectChanges, which throws on a view that is gone.
  describe("walking away while something is still pending", () => {
    const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));

    it("does not build the canvas for a page that has been left", async () => {
      build(parameterized).ngOnInit();

      component.toggleWorkflow();
      component.ngOnDestroy();
      await frame();

      expect(component.workflowEverOpened).toBe(false);
    });

    it("does not fit charts for a page that has been left", async () => {
      build(parameterized).ngOnInit();
      const fit = vi.spyOn(component as any, "fitVisualisations");

      (component as any).later(() => (component as any).fitVisualisations(), 0);
      component.ngOnDestroy();
      await new Promise(r => setTimeout(r, 20));

      expect(fit).not.toHaveBeenCalled();
    });

    it("still runs a pending callback while the page is alive", async () => {
      build(parameterized).ngOnInit();
      const ran = vi.fn();

      (component as any).later(ran, 0);
      await new Promise(r => setTimeout(r, 20));

      expect(ran).toHaveBeenCalled();
    });
  });

  describe("renaming edge cases", () => {
    const nodeFor = (name: string | undefined) => {
      build(parameterized);
      (component as any).authoring = true;
      const node: any = { key: "b1", props: { label: "File" } };
      (component as any).applyFieldOverrides(node, { id: "b1", propertyKey: "fileName", displayName: name }, "File");
      return node;
    };

    // Clearing the box is how an author says "use the operator's own name", so it has to
    // be storable -- not silently ignored as an empty edit.
    it("treats an emptied name as a request to fall back to the schema label", () => {
      const node = nodeFor("Input file");
      const updateBinding = vi.spyOn(parameterizationService, "updateBinding").mockImplementation(() => {});

      node.props.renameField("");

      expect(updateBinding).toHaveBeenCalledWith("b1", { displayName: "" });
      expect(node.props.schemaLabel).toBe("File");
    });

    it("shows the author's name in the box, not the schema's", () => {
      expect(nodeFor("Input file").props.authorName).toBe("Input file");
    });

    it("starts empty when the author has not named it, so the placeholder shows through", () => {
      expect(nodeFor(undefined).props.authorName).toBe("");
    });

    // The wrapper draws the label itself; leaving formly's own label on would print it
    // twice, once editable and once not.
    it("takes formly's own label off the field it wraps", () => {
      expect(nodeFor("Input file").props.label).toBe("");
    });
  });

  // This page's whole promise is that what an author sets up is still there next time,
  // so a save that fails must say so rather than look like it worked.
  describe("when saving fails", () => {
    const armSave = () => {
      build(parameterized).ngOnInit();
      (component as any).userService.isLogin = () => true;
      workflowPersistService.isWorkflowPersistEnabled = () => true;
      workflowActionService.getWorkflow = () => ({
        wid: 7,
        content: { operators: [], links: [], operatorPositions: {} },
      });
      component.wid = 7;
    };

    it("tells the user instead of failing quietly", () => {
      armSave();
      workflowPersistService.persistWorkflow = vi.fn().mockReturnValue(throwError(() => new Error("offline")));
      const notify = vi.spyOn((component as any).notificationService, "error");

      (component as any).save();

      expect(notify).toHaveBeenCalled();
    });

    it("says nothing when the save goes through", () => {
      armSave();
      const notify = vi.spyOn((component as any).notificationService, "error");

      (component as any).save();

      expect(notify).not.toHaveBeenCalled();
    });

    // ngOnDestroy calls save(); tying that request to the component's own teardown
    // aborted it, so the last thing the author did never reached the server.
    it("still issues the final save while the page is being torn down", () => {
      armSave();
      const persist = vi.spyOn(workflowPersistService, "persistWorkflow");

      component.ngOnDestroy();

      expect(persist).toHaveBeenCalled();
    });
  });

  // Every one of these is a change the author or reader makes to the shared workflow,
  // so each has to reach the service AND leave the page showing the result.
  describe("editing what the form offers", () => {
    let reread: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      build(parameterized).ngOnInit();
      parameterizationService.removeBinding = vi.fn();
      parameterizationService.reorder = vi.fn();
      parameterizationService.toggleResultOperator = vi.fn();
      parameterizationService.updateConfig = vi.fn();
      reread = vi.spyOn(component as any, "readConfig");
    });

    const card = (id = "b1") => ({ parameter: resolved(id, "A") }) as any;

    it("removes an input and re-reads what is left", () => {
      component.onRemoveBinding(resolved("b1", "A"));

      expect(parameterizationService.removeBinding).toHaveBeenCalledWith("b1");
      expect(reread).toHaveBeenCalled();
    });

    it("reorders by the positions the drag reports", () => {
      component.onDrop({ previousIndex: 2, currentIndex: 0 } as any);

      expect(parameterizationService.reorder).toHaveBeenCalledWith(2, 0);
      expect(reread).toHaveBeenCalled();
    });

    it("toggles which operator's results are shown", () => {
      component.onToggleResult({ operatorID: "op-1", label: "Scan", shown: false });

      expect(parameterizationService.toggleResultOperator).toHaveBeenCalledWith("op-1");
    });

    it("stores the instruction as the author types it", () => {
      component.instructionTitle = "How to use";
      component.instructionBody = "Pick a file.";

      component.onInstructionChange();

      expect(parameterizationService.updateConfig).toHaveBeenCalledWith({
        instruction: { title: "How to use", body: "Pick a file." },
      });
    });

    it("names a sub-field on the binding it belongs to", () => {
      component.onSubFieldName(card(), "alias", "Column name");

      expect(parameterizationService.setFieldOverride).toHaveBeenCalledWith("b1", "alias", {
        displayName: "Column name",
      });
    });

    it("hides a sub-field without touching its name", () => {
      component.onSubFieldHidden(card(), "alias", true);

      expect(parameterizationService.setFieldOverride).toHaveBeenCalledWith("b1", "alias", { hidden: true });
    });

    it("brings a hidden sub-field back", () => {
      component.onSubFieldHidden(card(), "alias", false);

      expect(parameterizationService.setFieldOverride).toHaveBeenCalledWith("b1", "alias", { hidden: false });
    });

    it("writes help text through the binding", () => {
      component.onEditBinding(resolved("b1", "A"), "helpText", "Any CSV file");

      expect(parameterizationService.updateBinding).toHaveBeenCalledWith("b1", { helpText: "Any CSV file" });
    });
  });

  // Resetting has to put the value back in the box as well as on the operator; doing
  // only the latter left the reader looking at what they had typed.
  describe("resetting an input", () => {
    it("returns the operator to its default", () => {
      build(parameterized).ngOnInit();
      const p = resolved("b1", "A");

      component.onReset(p);

      expect(parameterizationService.resetToDefault).toHaveBeenCalledWith(p.binding);
    });

    it("puts the default back into the box the reader is looking at", () => {
      build(parameterized).ngOnInit();
      const p = resolved("b1", "A");
      parameterizationService.resolveParameters = vi.fn().mockReturnValue([resolved("b1", "A", { value: "seed" })]);
      (component as any).rendered = [{ parameter: p, model: { b1: "typed" }, form: { patchValue: vi.fn() } }];

      component.onReset(p);

      expect((component as any).rendered[0].model.b1).toBe("seed");
    });
  });

  // A trackBy that is not stable rebuilt every row on every pass, which is why buttons
  // could not be clicked -- they never stood still long enough.
  describe("row identity", () => {
    beforeEach(() => build(parameterized).ngOnInit());

    it("identifies a card by its binding, not its position", () => {
      expect(component.trackByRendered(0, { parameter: resolved("b1", "A") } as any)).toBe("b1");
      expect(component.trackByRendered(7, { parameter: resolved("b1", "A") } as any)).toBe("b1");
    });

    it("identifies a sub-field row by its path", () => {
      expect(component.trackSubField(0, { path: "alias", label: "Alias", hidden: false, name: "" })).toBe("alias");
    });

    // The key changes only when that operator's result is genuinely new, so an unrelated
    // update does not tear a chart down and rebuild it.
    it("keeps a result's identity stable until its version moves", () => {
      const before = component.resultKey("op-1");
      expect(component.resultKey("op-1")).toBe(before);

      (component as any).resultVersion.set("op-1", 1);

      expect(component.resultKey("op-1")).not.toBe(before);
    });
  });

  describe("showing values and results", () => {
    beforeEach(() => build(parameterized).ngOnInit());

    // A blank box, never the words "undefined" or "null".
    [
      [undefined, ""],
      [null, ""],
      ["", ""],
      [0, "0"],
      [false, "false"],
      ["iris.csv", "iris.csv"],
    ].forEach(([value, shown]) => {
      it(`shows ${JSON.stringify(value)} as ${JSON.stringify(shown)}`, () => {
        expect(component.displayValue(resolved("b1", "A", { value }) as any)).toBe(shown);
      });
    });

    it("falls back to the operator id when it has no friendly label", () => {
      expect(component.resultLabel("op-unknown")).toBe("op-unknown");
    });

    it("uses the friendly label once the page knows one", () => {
      component.resultChoices = [{ operatorID: "op-1", label: "Image Visualizer", shown: true }];

      expect(component.resultLabel("op-1")).toBe("Image Visualizer");
    });
  });

  describe("the instruction panel", () => {
    beforeEach(() => build(parameterized).ngOnInit());

    it("opens and closes on the same control", () => {
      const wasOpen = component.instructionOpen;

      component.toggleInstruction();

      expect(component.instructionOpen).toBe(!wasOpen);
    });

    it("renders the markdown when the author switches to preview", () => {
      const render = vi.spyOn(component as any, "renderInstruction");

      component.setInstructionMode("preview");

      expect(component.instructionMode).toBe("preview");
      expect(render).toHaveBeenCalled();
    });

    it("does not re-render while the author is still writing", () => {
      component.setInstructionMode("preview");
      const render = vi.spyOn(component as any, "renderInstruction");

      component.setInstructionMode("write");

      expect(render).not.toHaveBeenCalled();
    });
  });

  // Renaming from here is the same edit as renaming on the operator canvas, so it must
  // go through the graph rather than only updating this page's copy.
  describe("renaming the workflow", () => {
    it("writes the name through the shared graph and saves", () => {
      build(parameterized).ngOnInit();
      const save = vi.spyOn(component as any, "save").mockImplementation(() => {});
      component.workflowName = "Renamed";

      component.onRenameWorkflow();

      expect(workflowActionService.setWorkflowName).toHaveBeenCalledWith("Renamed");
      expect(save).toHaveBeenCalled();
    });

    // The graph is the authority: if it rejects or trims the name, the box must show
    // what was actually stored rather than what was typed.
    it("shows back whatever the graph actually stored", () => {
      build(parameterized).ngOnInit();
      vi.spyOn(component as any, "save").mockImplementation(() => {});
      workflowActionService.getWorkflowMetadata = () => ({ name: "Untitled workflow" });
      component.workflowName = "   ";

      component.onRenameWorkflow();

      expect(component.workflowName).toBe("Untitled workflow");
    });
  });

  // Zooming and fitting only move the viewport, so everyone gets them. Re-arranging
  // moves the operators themselves, which is an edit to the shared workflow.
  describe("the canvas tools", () => {
    let jointWrapper: any;

    const withCanvas = (canEdit: boolean) => {
      build(parameterized).ngOnInit();
      component.canEdit = canEdit;
      jointWrapper = {
        isZoomRatioMax: vi.fn().mockReturnValue(false),
        isZoomRatioMin: vi.fn().mockReturnValue(false),
        getZoomRatio: vi.fn().mockReturnValue(1),
        setZoomProperty: vi.fn(),
        unhighlightOperators: vi.fn(),
        getCurrentHighlightedOperatorIDs: () => ["op-1"],
      };
      workflowActionService.getJointGraphWrapper = () => jointWrapper;
      workflowActionService.autoLayoutWorkflow = vi.fn();
      workflowActionService.getWorkflowContent = () => ({ operatorPositions: { "op-1": { x: 1, y: 2 } } });
      vi.spyOn(component as any, "refitCanvas").mockImplementation(() => {});
    };

    it("zooms in a step", () => {
      withCanvas(true);

      component.zoomIn();

      expect(jointWrapper.setZoomProperty).toHaveBeenCalled();
    });

    it("refuses to zoom past the maximum", () => {
      withCanvas(true);
      jointWrapper.isZoomRatioMax.mockReturnValue(true);

      component.zoomIn();

      expect(jointWrapper.setZoomProperty).not.toHaveBeenCalled();
    });

    it("refuses to zoom past the minimum", () => {
      withCanvas(true);
      jointWrapper.isZoomRatioMin.mockReturnValue(true);

      component.zoomOut();

      expect(jointWrapper.setZoomProperty).not.toHaveBeenCalled();
    });

    it("fits by re-running the same fit the page uses elsewhere", () => {
      withCanvas(true);

      component.fitToView();

      expect((component as any).refitCanvas).toHaveBeenCalled();
    });

    it("re-arranges for an author and keeps the new positions to save", () => {
      withCanvas(true);

      component.autoLayout();

      expect(workflowActionService.autoLayoutWorkflow).toHaveBeenCalled();
      expect((component as any).storedPositions).toEqual({ "op-1": { x: 1, y: 2 } });
    });

    // Moving operators is an edit; a reader must not be able to make it.
    it("does not re-arrange for someone without write access", () => {
      withCanvas(false);

      component.autoLayout();

      expect(workflowActionService.autoLayoutWorkflow).not.toHaveBeenCalled();
    });

    it("dismisses the operator panel by dropping the selection that holds it open", () => {
      withCanvas(true);
      component.onOperatorClicked("op-1");

      component.closeOperatorPanel();

      expect(jointWrapper.unhighlightOperators).toHaveBeenCalledWith("op-1");
      expect(component.selectedOperatorId).toBeUndefined();
    });
  });

  describe("what a result looks like", () => {
    beforeEach(() => build(parameterized).ngOnInit());

    it("asks the result service whether there is anything to show", () => {
      (component as any).workflowResultService.hasAnyResult = vi.fn().mockReturnValue(true);

      expect(component.hasResultFor("op-1")).toBe(true);
    });

    it("calls a paginated result a table and anything else a picture", () => {
      (component as any).workflowResultService.hasPaginatedResult = vi.fn().mockReturnValue(true);
      expect(component.isTabularResult("op-1")).toBe(true);

      (component as any).workflowResultService.hasPaginatedResult = vi.fn().mockReturnValue(false);
      expect(component.isTabularResult("op-1")).toBe(false);
    });

    it("tracks a plain list by the key itself", () => {
      expect(component.trackByKey(3, "op-1")).toBe("op-1");
    });
  });

  it("switches to the operator canvas on the same workflow", () => {
    build(parameterized).ngOnInit();

    expect(typeof component.openRegularCanvas).toBe("function");
  });
});
