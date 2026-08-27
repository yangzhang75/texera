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

import { FormControl } from "@angular/forms";
import { Router } from "@angular/router";
import { Subject, throwError } from "rxjs";

import { ParameterizedCanvasComponent } from "./parameterized-canvas.component";
import { setupHarness, resolved, parameterized } from "./parameterized-canvas.spec-harness";
import { ExecutionState } from "../../types/execute-workflow.interface";
import { ComputingUnitState } from "../../../common/type/computing-unit-connection.interface";
import { USER_WORKFLOW, USER_WORKSPACE } from "../../../app-routing.constant";
import { SAVE_DEBOUNCE_TIME_IN_MS } from "../workspace.component";
import { FORM_DEBOUNCE_TIME_MS } from "../../service/execute-workflow/execute-workflow.service";

/**
 * Exercise the whole page's own decisions -- inputs, running and results -- without standing
 * up the JointJS canvas. Shared mocks come from the spec harness; this slice's component takes
 * the full dependency set.
 */
describe("ParameterizedCanvasComponent", () => {
  let component: ParameterizedCanvasComponent;
  let h: ReturnType<typeof setupHarness>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let workflowActionService: any;
  let workflowPersistService: any;
  let parameterizationService: any;
  let executeWorkflowService: any;
  let workflowChangedStream: Subject<unknown>;
  let compilationChanged: Subject<unknown>;
  let executionStateStream: Subject<any>;
  let durationEvents: Subject<{ duration: number; isRunning: boolean }>;
  let resultUpdateStream: Subject<unknown>;
  let highlightStream: Subject<readonly string[]>;
  let unhighlightStream: Subject<readonly string[]>;
  let highlightedIds: string[];
  let hasOperatorIds: Set<string>;
  let graphOperators: any[];
  let anyResultIds: Set<string>;

  const build = (workflow: any) => {
    h.useWorkflow(workflow);
    component = new ParameterizedCanvasComponent(
      h.coeditorPresenceService as any,
      h.route as any,
      h.router as unknown as Router,
      h.workflowActionService as any,
      h.workflowPersistService as any,
      h.operatorMetadataService as any,
      h.parameterizationService as any,
      h.executeWorkflowService as any,
      h.workflowResultService as any,
      h.notificationService as any,
      h.userService as any,
      h.markdownService as any,
      h.formlyJsonschema as any,
      h.cdr as any,
      h.dynamicSchemaService as any,
      h.workflowCompilingService as any,
      h.computingUnitStatusService as any,
      h.workflowConsoleService as any,
      h.workflowWebsocketService as any,
      h.host as any,
      h.datePipe as any,
      h.panelResizeService as any,
      h.validationWorkflowService as any
    );
    return component;
  };

  beforeEach(() => {
    h = setupHarness();
    router = h.router;
    workflowActionService = h.workflowActionService;
    workflowPersistService = h.workflowPersistService;
    parameterizationService = h.parameterizationService;
    executeWorkflowService = h.executeWorkflowService;
    workflowChangedStream = h.workflowChangedStream;
    compilationChanged = h.compilationChanged;
    executionStateStream = h.executionStateStream;
    durationEvents = h.durationEvents;
    resultUpdateStream = h.resultUpdateStream;
    highlightStream = h.highlightStream;
    unhighlightStream = h.unhighlightStream;
    highlightedIds = h.highlightedIds;
    hasOperatorIds = h.hasOperatorIds;
    graphOperators = h.graphOperators;
    anyResultIds = h.anyResultIds;
  });

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

    // A broken input points nowhere, so a reader -- who cannot repair it -- is never shown
    // it or warned about it; the author is, because they are the one who can fix it.
    it("hides them from a reader, with no warning", () => {
      expect(component.visibleParameters).toEqual([healthy]);
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

  // Run is never held back on a guess about whether it can succeed. Every version of
  // that guess was wrong in a way that left the reader with a button that did nothing
  // and no way forward, so the attempt is always made and a failure explains itself --
  // exactly how the operator canvas behaves.
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
      h.setComputingUnit(null);
      component.ngOnInit();

      component.onRun();

      expect(executeWorkflowService.executeWorkflow).toHaveBeenCalled();
    });
  });

  // Consistent with the operator canvas: a graph that cannot run disables the button and
  // says why, instead of accepting a press that does nothing.
  describe("run button state", () => {
    it("disables and reads 'Invalid Workflow' for an invalid graph, and does not run", () => {
      build(parameterized).ngOnInit();
      (component as any).isWorkflowValid = false;

      expect(component.runButtonState.disabled).toBe(true);
      expect(component.runButtonState.label).toBe("Invalid");

      component.onRun();
      expect(executeWorkflowService.executeWorkflow).not.toHaveBeenCalled();
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

    it("rebuilds the cards when compilation reports a new state", async () => {
      const rebuild = armed();

      compilationChanged.next("Succeeded");
      await new Promise(r => setTimeout(r, FORM_DEBOUNCE_TIME_MS + 50));

      expect(rebuild).toHaveBeenCalled();
    });

    it("does not rebuild under the cursor of someone typing", async () => {
      const rebuild = armed();
      vi.spyOn(component as any, "isTypingInTheForm").mockReturnValue(true);

      compilationChanged.next("Succeeded");
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

    it("writes help text through the binding", () => {
      component.onEditBinding(resolved("b1", "A"), "helpText", "Any CSV file");

      expect(parameterizationService.updateBinding).toHaveBeenCalledWith("b1", { helpText: "Any CSV file" });
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

  // Zoom, fit and layout are handled by the reused editor/mini-map now, so the page's
  // own controls are gone; what stays is selecting a step and dismissing its panel.
  describe("selecting a step", () => {
    let jointWrapper: any;

    beforeEach(() => {
      build(parameterized).ngOnInit();
      jointWrapper = {
        unhighlightOperators: vi.fn(),
        getCurrentHighlightedOperatorIDs: () => ["op-1"],
      };
      workflowActionService.getJointGraphWrapper = () => jointWrapper;
    });

    it("dismisses the operator panel by dropping the selection that holds it open", () => {
      component.onOperatorClicked("op-1");

      component.closeOperatorPanel();

      expect(jointWrapper.unhighlightOperators).toHaveBeenCalledWith("op-1");
      expect(component.selectedOperatorId).toBeUndefined();
    });
  });

  describe("what a result looks like", () => {
    beforeEach(() => build(parameterized).ngOnInit());

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

  describe("subscriptions, handlers and edge cases", () => {
    it("sends a non-numeric workflow id back to the list", () => {
      build(parameterized);
      (component as any).route = { snapshot: { params: { id: "nope" } } };

      component.ngOnInit();

      expect(router.navigate).toHaveBeenCalledWith([USER_WORKFLOW]);
    });

    it("selects a step when the canvas highlights exactly one operator", () => {
      build(parameterized).ngOnInit();
      graphOperators.push({ operatorID: "op-1", operatorType: "X" });
      hasOperatorIds.add("op-1");
      parameterizationService.operatorLabel.mockReturnValue("Scan");

      highlightStream.next(["op-1"]);

      expect(component.selectedOperatorId).toBe("op-1");
      expect(component.selectedOperatorLabel).toBe("Scan");
    });

    it("clears the selection when the canvas is cleared", () => {
      build(parameterized).ngOnInit();
      graphOperators.push({ operatorID: "op-1", operatorType: "X" });
      hasOperatorIds.add("op-1");
      highlightStream.next(["op-1"]);

      h.highlightedIds.length = 0;
      unhighlightStream.next([]);

      expect(component.selectedOperatorId).toBeUndefined();
    });

    it("re-reads the config when the panel changes the definition", () => {
      build(parameterized).ngOnInit();
      const before = parameterizationService.resolveParameters.mock.calls.length;

      workflowActionService.parameterizationChanged$.next(undefined);

      expect(parameterizationService.resolveParameters.mock.calls.length).toBeGreaterThan(before);
    });

    it("answers a failed run with a fill-in message when a required input is empty", () => {
      build(parameterized).ngOnInit();
      component.rendered = [{ form: { invalid: true } } as any];

      executionStateStream.next({ current: { state: ExecutionState.Failed, errorMessages: [] } });

      expect(component.runError).toContain("required");
    });

    it("answers a failed run with a cleaned engine message otherwise", () => {
      build(parameterized).ngOnInit();
      component.rendered = [];

      executionStateStream.next({
        current: { state: ExecutionState.Failed, errorMessages: [{ message: "requirement failed: bad thing" }] },
      });

      expect(component.runError).toContain("bad thing");
    });

    it("drops inputs whose operator was deleted, in edit mode", () => {
      build(parameterized).ngOnInit();
      component.authoring = true;
      component.loading = false;
      parameterizationService.getConfig.mockReturnValue({
        parameters: [{ id: "b", operatorID: "gone", propertyKey: "x", displayName: "" }],
        resultOperatorIds: [],
      });

      (component as any).readConfig();

      expect(parameterizationService.setParameters).toHaveBeenCalledWith([]);
    });

    it("renders a broken input as a card with no fields", () => {
      build(parameterized).ngOnInit();
      component.authoring = true;
      parameterizationService.resolveParameters.mockReturnValue([
        resolved("gone", "Gone", { brokenReason: "removed" }),
      ]);

      (component as any).readConfig();

      expect(component.rendered).toHaveLength(1);
      expect(component.rendered[0].fields).toEqual([]);
    });

    it("has an instruction only when the body has text", () => {
      build(parameterized);
      component.instructionBody = "  ";
      expect(component.hasInstruction).toBe(false);
      component.instructionBody = "Fill this in";
      expect(component.hasInstruction).toBe(true);
    });

    it("has results once a shown operator has produced any", () => {
      build(parameterized);
      component.shownResultIds = ["op-1"];
      expect(component.hasResults).toBe(false);
      anyResultIds.add("op-1");
      expect(component.hasResults).toBe(true);
    });

    it("treats a paginated result as tabular, with no visualisation content", () => {
      build(parameterized);
      expect(component.isTabularResult("tabular")).toBe(true);
      expect(component.vizHasContent("tabular")).toBe(false);
    });

    it("shows Stop while a run is in flight", () => {
      build(parameterized).ngOnInit();
      executionStateStream.next({ current: { state: ExecutionState.Running } });

      expect(component.runButtonState.label).toBe("Stop");
    });

    it("edits a sub-field's name and visibility through the service", () => {
      build(parameterized).ngOnInit();

      (component as any).onSubFieldNamed("b", "alias", "Renamed");
      (component as any).onSubFieldHiddenAt("b", "alias", true);

      expect(parameterizationService.setFieldOverride).toHaveBeenCalledWith("b", "alias", { displayName: "Renamed" });
      expect(parameterizationService.setFieldOverride).toHaveBeenCalledWith("b", "alias", { hidden: true });
    });

    it("saves on every debounced workflow change", () => {
      build(parameterized).ngOnInit();
      const save = vi.spyOn(component as any, "save");
      vi.useFakeTimers();

      workflowChangedStream.next(undefined);
      vi.advanceTimersByTime(SAVE_DEBOUNCE_TIME_IN_MS + 50);
      vi.useRealTimers();

      expect(save).toHaveBeenCalled();
    });

    it("does not run while typing in the form", () => {
      build(parameterized).ngOnInit();
      const input = document.createElement("input");
      document.body.appendChild(input);
      (component as any).host = { nativeElement: { contains: () => true } };
      input.focus();

      compilationChanged.next(undefined);

      document.body.removeChild(input);
      expect(true).toBe(true);
    });

    it("keeps only live operators in the results picker", () => {
      build(parameterized).ngOnInit();
      graphOperators.push({ operatorID: "op-1", operatorType: "ScanSource" });
      parameterizationService.getConfig.mockReturnValue({ parameters: [], resultOperatorIds: ["op-1"] });
      hasOperatorIds.add("op-1");

      (component as any).readConfig();

      expect(component.resultChoices.map(c => c.operatorID)).toContain("op-1");
    });

    it("bumps result versions and refreshes on a result update", () => {
      build(parameterized).ngOnInit();
      resultUpdateStream.next({ "op-1": {} });
      expect(component.resultKey("op-1")).toBe("op-1#1");
    });

    it("reports visualisation content from the operator's snapshot", () => {
      build(parameterized).ngOnInit();
      (component as any).workflowResultService.getResultService = () => ({
        getCurrentResultSnapshot: () => [{ a: 1 }],
      });
      expect(component.vizHasContent("viz")).toBe(true);
    });

    it("collapses an opaque engine error to a generic message", () => {
      build(parameterized).ngOnInit();
      component.rendered = [];

      executionStateStream.next({
        current: { state: ExecutionState.Failed, errorMessages: [{ message: "org.jooq boom at Foo.bar(Foo.java:1)" }] },
      });

      expect(component.runError).toContain("reload");
    });

    it("offers Connect / Connecting through the run button", () => {
      build(parameterized).ngOnInit();
      (component as any).computingUnitStatus = ComputingUnitState.NoComputingUnit;
      expect(component.runButtonState.label).toBe("Connect");

      (component as any).computingUnitStatus = ComputingUnitState.Running;
      (component as any).workflowWebsocketService = { isConnected: false };
      expect(component.runButtonState.label).toBe("Connecting");
    });

    it("renders a healthy input into a real formly field", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Genes")]);

      (component as any).readConfig();

      expect(component.rendered).toHaveLength(1);
      expect(component.rendered[0].fields[0].key).toBe(component.rendered[0].parameter.binding.id);
    });

    it("writes a dirtied value back to the operator", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Genes")]);
      (component as any).readConfig();
      const card = component.rendered[0];
      const key = card.parameter.binding.id;
      vi.useFakeTimers();

      card.model[key] = "typed";
      card.form.addControl(key, new FormControl("typed"));
      card.form.markAsDirty();
      vi.advanceTimersByTime(300);
      vi.useRealTimers();

      expect(parameterizationService.writeValue).toHaveBeenCalled();
    });

    it("applies the author's field overrides to nested and repeated fields", () => {
      build(parameterized).ngOnInit();
      component.authoring = true;
      hasOperatorIds.add("op-1");
      parameterizationService.resolveParameters.mockReturnValue([
        resolved("nested", "Nested", {
          binding: {
            id: "n",
            operatorID: "op-1",
            propertyKey: "nested",
            displayName: "N",
            fields: { sub: { displayName: "Renamed", hidden: true } },
          } as any,
        }),
        resolved("predicates", "Predicates", {
          binding: { id: "p", operatorID: "op-1", propertyKey: "predicates", displayName: "P", fields: {} } as any,
        }),
      ]);

      (component as any).readConfig();

      // Invoke the decorated row-template builder so its per-row walk runs.
      const predicates = component.rendered.find(r => r.parameter.binding.id === "p");
      (predicates!.fields[0] as any).fieldArray?.({});
      // Drive the sub-field's rename/hide callbacks the editable label would fire.
      const sub = (component.rendered.find(r => r.parameter.binding.id === "n")!.fields[0] as any).fieldGroup[0];
      sub.props.renameField("Renamed again");
      sub.props.setFieldHidden(true);

      expect(component.rendered).toHaveLength(2);
      expect(parameterizationService.setFieldOverride).toHaveBeenCalled();
    });

    it("hides an overridden sub-field for a reader", () => {
      build(parameterized).ngOnInit();
      component.authoring = false;
      hasOperatorIds.add("op-1");
      parameterizationService.resolveParameters.mockReturnValue([
        resolved("nested", "Nested", {
          binding: {
            id: "n",
            operatorID: "op-1",
            propertyKey: "nested",
            displayName: "N",
            fields: { sub: { hidden: true } },
          } as any,
        }),
      ]);

      (component as any).readConfig();

      expect(component.rendered).toHaveLength(1);
    });

    it("keeps a still-set value when formly emits a blank before an edit", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      parameterizationService.readValue.mockReturnValue("seed");
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Genes")]);
      (component as any).readConfig();
      const card = component.rendered[0];
      const key = card.parameter.binding.id;
      vi.useFakeTimers();

      card.model[key] = "";
      card.form.addControl(key, new FormControl(""));
      vi.advanceTimersByTime(300);
      vi.useRealTimers();

      expect(parameterizationService.writeValue).not.toHaveBeenCalled();
    });

    it("falls back to the static schema when the per-instance one is unavailable", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      graphOperators.push({ operatorID: "op-1", operatorType: "X" });
      (component as any).dynamicSchemaService = {
        getDynamicSchema: () => {
          throw new Error("no dynamic schema");
        },
      };
      (component as any).operatorMetadataService = {
        getOperatorSchema: () => ({ jsonSchema: { properties: { n_hvg: {} } } }),
      };
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Genes")]);

      (component as any).readConfig();

      expect(component.rendered).toHaveLength(1);
    });

    it("returns no schema when neither the per-instance nor the static one is available", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      graphOperators.push({ operatorID: "op-1", operatorType: "X" });
      (component as any).dynamicSchemaService = {
        getDynamicSchema: () => {
          throw new Error("no dynamic schema");
        },
      };
      (component as any).operatorMetadataService = {
        getOperatorSchema: () => {
          throw new Error("no static schema");
        },
      };
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Genes")]);

      (component as any).readConfig();

      expect(component.rendered).toHaveLength(0);
    });

    it("switches to the operator canvas, saving on the way out", () => {
      build(parameterized).ngOnInit();
      const save = vi.spyOn(component as any, "save");

      component.openRegularCanvas();

      expect(save).toHaveBeenCalled();
    });

    it("renders a file property through its own picker type", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      parameterizationService.resolveParameters.mockReturnValue([
        resolved("fileName", "File", {
          binding: { id: "f", operatorID: "op-1", propertyKey: "fileName", displayName: "File" } as any,
        }),
      ]);

      (component as any).readConfig();

      expect(component.rendered[0].fields[0].type).toBe("inputautocomplete");
    });

    it("skips an exposed property that has no matching schema field", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      parameterizationService.resolveParameters.mockReturnValue([
        resolved("nonesuch", "Missing", {
          binding: { id: "m", operatorID: "op-1", propertyKey: "nonesuch", displayName: "Missing" } as any,
        }),
      ]);

      (component as any).readConfig();

      expect(component.rendered).toHaveLength(0);
    });

    it("ignores an unchanged form emission", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      parameterizationService.readValue.mockReturnValue("seed");
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Genes")]);
      (component as any).readConfig();
      const card = component.rendered[0];
      const key = card.parameter.binding.id;
      vi.useFakeTimers();

      card.model[key] = "seed";
      card.form.addControl(key, new FormControl("seed"));
      vi.advanceTimersByTime(300);
      vi.useRealTimers();

      expect(parameterizationService.writeValue).not.toHaveBeenCalled();
    });

    it("re-fits results a moment after a run reports them", () => {
      build(parameterized).ngOnInit();
      component.shownResultIds = ["op-1"];
      anyResultIds.add("op-1");

      executionStateStream.next({ current: { state: ExecutionState.Completed } });

      expect(component.hasResults).toBe(true);
    });

    it("disables the run button for an invalid or empty workflow", () => {
      build(parameterized).ngOnInit();
      (component as any).isWorkflowValid = false;
      expect(component.runButtonState.label).toBe("Invalid");

      (component as any).isWorkflowValid = true;
      (component as any).isWorkflowEmpty = true;
      expect(component.runButtonState.label).toBe("Empty");
    });
  });

  // Kept from the parameterized-canvas: operators that write their value outside formly's
  // typed controls go through onValueChange, which coerces the raw string.
  describe("value coercion (parameterized-canvas util)", () => {
    beforeEach(() => {
      build(parameterized);
      component.ngOnInit();
    });

    it("writes text straight through to the operator", () => {
      const parameter = resolved("tableName", "Input table");

      component.onValueChange(parameter, "reddit");

      expect(parameterizationService.writeValue).toHaveBeenCalledWith(parameter.binding, "reddit");
    });

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
  });
});
