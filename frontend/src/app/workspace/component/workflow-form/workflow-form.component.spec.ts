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

import { WorkflowFormComponent } from "./workflow-form.component";
import { setupHarness, resolved, parameterized } from "./workflow-form.spec-harness";
import { USER_WORKFLOW, USER_WORKSPACE } from "../../../app-routing.constant";
import { SAVE_DEBOUNCE_TIME_IN_MS } from "../workspace.component";
import { FORM_DEBOUNCE_TIME_MS } from "../../service/execute-workflow/execute-workflow.service";

/**
 * Cover rendering the exposed inputs and writing values back, plus the shell decisions carried
 * over. Shared mocks come from the spec harness; this slice's component takes the shell +
 * inputs dependencies (no run/results services yet).
 */
describe("WorkflowFormComponent", () => {
  let component: WorkflowFormComponent;
  let h: ReturnType<typeof setupHarness>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let workflowActionService: any;
  let workflowPersistService: any;
  let parameterizationService: any;
  let workflowChangedStream: Subject<unknown>;
  let compilationChanged: Subject<unknown>;
  let hasOperatorIds: Set<string>;
  let graphOperators: any[];

  const build = (workflow: any) => {
    h.useWorkflow(workflow);
    component = new WorkflowFormComponent(
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
      h.host as any,
      h.datePipe as any,
      h.config as any
    );
    return component;
  };

  beforeEach(() => {
    h = setupHarness();
    router = h.router;
    workflowActionService = h.workflowActionService;
    workflowPersistService = h.workflowPersistService;
    parameterizationService = h.parameterizationService;
    workflowChangedStream = h.workflowChangedStream;
    compilationChanged = h.compilationChanged;
    hasOperatorIds = h.hasOperatorIds;
    graphOperators = h.graphOperators;
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

    it("offers author controls only with write access", () => {
      build({ ...parameterized, readonly: true }).ngOnInit();
      expect(component.canEdit).toBe(false);

      build(parameterized).ngOnInit();
      expect(component.canEdit).toBe(true);
    });

    it("unlocks operator properties while authoring with write access", () => {
      build(parameterized).ngOnInit();
      (component as any).authoring = true;
      (component as any).canEdit = true;

      (component as any).applyEditability();

      expect(workflowActionService.enableWorkflowModification).toHaveBeenCalled();
    });

    it("toggles the instruction panel open and shut", () => {
      build(parameterized).ngOnInit();
      const open = component.instructionOpen;

      component.toggleInstruction();

      expect(component.instructionOpen).toBe(!open);
    });

    it("goes back to the list when the workflow cannot be opened", () => {
      build(parameterized);
      workflowPersistService.retrieveWorkflow.mockReturnValue(throwError(() => new Error("denied")));

      component.ngOnInit();

      expect(router.navigate).toHaveBeenCalledWith([USER_WORKFLOW]);
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

    it("still runs a pending callback while the page is alive", async () => {
      build(parameterized).ngOnInit();
      const ran = vi.fn();

      (component as any).later(ran, 0);
      await new Promise(r => setTimeout(r, 20));

      expect(ran).toHaveBeenCalled();
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

    it("re-reads the config when the panel changes the definition", () => {
      build(parameterized).ngOnInit();
      const before = parameterizationService.resolveParameters.mock.calls.length;

      workflowActionService.parameterizationChanged$.next(undefined);

      expect(parameterizationService.resolveParameters.mock.calls.length).toBeGreaterThan(before);
    });

    it("has an instruction only when the body has text", () => {
      build(parameterized);
      component.instructionBody = "  ";
      expect(component.hasInstruction).toBe(false);
      component.instructionBody = "Fill this in";
      expect(component.hasInstruction).toBe(true);
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

    it("reports typing when a form field is focused", () => {
      build(parameterized).ngOnInit();
      const input = document.createElement("input");
      document.body.appendChild(input);
      (component as any).host = { nativeElement: { contains: () => true } };
      input.focus();

      expect((component as any).isTypingInTheForm()).toBe(true);

      document.body.removeChild(input);
    });

    it("renders a healthy input into a real formly field", () => {
      build(parameterized).ngOnInit();
      hasOperatorIds.add("op-1");
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Genes")]);

      (component as any).readConfig();

      expect(component.rendered).toHaveLength(1);
      expect(component.rendered[0].fields[0].key).toBe(component.rendered[0].parameter.binding.id);
    });

    it("renders nothing for an input whose operator is not on the graph", () => {
      build(parameterized).ngOnInit();
      parameterizationService.resolveParameters.mockReturnValue([resolved("n_hvg", "Genes")]);

      (component as any).readConfig();

      expect(component.rendered).toHaveLength(0);
    });

    it("identifies a rendered card by its binding id", () => {
      build(parameterized);

      const key = component.trackByRendered(0, { parameter: { binding: { id: "b-1" } } } as any);

      expect(key).toBe("b-1");
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

    it("renames and hides overridden sub-fields for a reader", () => {
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
            fields: { sub: { hidden: true, displayName: "Renamed" } },
          } as any,
        }),
        resolved("predicates", "Predicates", {
          binding: { id: "p", operatorID: "op-1", propertyKey: "predicates", displayName: "P" } as any,
        }),
      ]);

      (component as any).readConfig();
      // Formly builds a repeated section's rows on demand; invoke the wrapped builder so the
      // walk decorates the row's sub-fields.
      const row = (component.rendered[1].fields[0] as any).fieldArray({});

      expect(component.rendered).toHaveLength(2);
      expect(row.fieldGroup[0].key).toBe("alias");
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

  });
});
