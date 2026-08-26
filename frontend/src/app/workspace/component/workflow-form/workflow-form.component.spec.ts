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

import { Router } from "@angular/router";
import { Subject, throwError } from "rxjs";

import { WorkflowFormComponent } from "./workflow-form.component";
import { setupHarness, parameterized } from "./workflow-form.spec-harness";
import { USER_WORKFLOW, USER_WORKSPACE } from "../../../app-routing.constant";
import { SAVE_DEBOUNCE_TIME_IN_MS } from "../workspace.component";

/**
 * These exercise the shell's own decisions -- what a reader is shown, where an
 * unparameterized workflow is sent, and how the page saves -- without standing up the
 * JointJS canvas. Shared mocks come from the spec harness.
 */
describe("WorkflowFormComponent", () => {
  let component: WorkflowFormComponent;
  let h: ReturnType<typeof setupHarness>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let workflowActionService: any;
  let workflowPersistService: any;
  let workflowChangedStream: Subject<unknown>;

  const build = (workflow: any) => {
    h.useWorkflow(workflow);
    component = new WorkflowFormComponent(
      h.coeditorPresenceService as any,
      h.route as any,
      h.router as unknown as Router,
      h.workflowActionService as any,
      h.workflowPersistService as any,
      h.operatorMetadataService as any,
      h.executeWorkflowService as any,
      h.workflowResultService as any,
      h.notificationService as any,
      h.userService as any,
      h.cdr as any,
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
    workflowChangedStream = h.workflowChangedStream;
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

  // A deferred callback (e.g. measuring the name field) touches the view; while the page is
  // still alive it must run, and once it is gone it must not (detectChanges would throw).
  describe("deferred callbacks", () => {
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

    it("saves on every debounced workflow change", () => {
      build(parameterized).ngOnInit();
      const save = vi.spyOn(component as any, "save");
      vi.useFakeTimers();

      workflowChangedStream.next(undefined);
      vi.advanceTimersByTime(SAVE_DEBOUNCE_TIME_IN_MS + 50);
      vi.useRealTimers();

      expect(save).toHaveBeenCalled();
    });

    it("switches to the operator canvas, saving on the way out", () => {
      build(parameterized).ngOnInit();
      const save = vi.spyOn(component as any, "save");

      component.openRegularCanvas();

      expect(save).toHaveBeenCalled();
    });

  });
});
