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

import {
  ChangeDetectorRef,
  Component,
  OnChanges,
  SimpleChanges,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  Type,
  ViewChild, Input } from "@angular/core";
import { merge } from "rxjs";
import { WorkflowActionService } from "../../service/workflow-graph/model/workflow-action.service";
import { OperatorPropertyEditFrameComponent } from "./operator-property-edit-frame/operator-property-edit-frame.component";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { distinctUntilChanged } from "rxjs/operators";
import { filter } from "rxjs/operators";
import { PortPropertyEditFrameComponent } from "./port-property-edit-frame/port-property-edit-frame.component";
import { NzResizeEvent, NzResizableDirective, NzResizeHandlesComponent } from "ng-zorro-antd/resizable";
import { calculateTotalTranslate3d } from "../../../common/util/panel-dock";
import { PanelService } from "../../service/panel/panel.service";
import { ParameterizationService } from "../../service/parameterization/parameterization.service";
import { NzMenuDirective, NzMenuItemComponent, NzMenuDividerDirective } from "ng-zorro-antd/menu";
import { NgClass, NgIf, NgComponentOutlet } from "@angular/common";
import { ɵNzTransitionPatchDirective } from "ng-zorro-antd/core/transition-patch";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzTooltipDirective } from "ng-zorro-antd/tooltip";
import { CdkDrag, CdkDragHandle } from "@angular/cdk/drag-drop";
import { NzSpaceCompactItemDirective } from "ng-zorro-antd/space";
import { NzButtonComponent } from "ng-zorro-antd/button";

/** Narrowest the panel can be dragged to; a stored width below this means "closed". */
const MIN_PANEL_WIDTH = 260;

/**
 * PropertyEditorComponent is the panel that allows user to edit operator properties.
 * Depending on the highlighted operator or link, it displays OperatorPropertyEditFrameComponent
 * or BreakpointPropertyEditFrameComponent accordingly
 *
 */
@UntilDestroy()
@Component({
  selector: "texera-property-editor",
  templateUrl: "property-editor.component.html",
  styleUrls: ["property-editor.component.scss"],
  imports: [
    NzMenuDirective,
    NgClass,
    NgIf,
    NzMenuItemComponent,
    ɵNzTransitionPatchDirective,
    NzIconDirective,
    NzTooltipDirective,
    CdkDrag,
    NzResizableDirective,
    NzSpaceCompactItemDirective,
    NzButtonComponent,
    NzMenuDividerDirective,
    CdkDragHandle,
    NgComponentOutlet,
    NzResizeHandlesComponent,
  ],
})
export class PropertyEditorComponent implements OnInit, OnDestroy, OnChanges {
  @ViewChild("contentWrapper") contentWrapperRef!: ElementRef;
  protected readonly window = window;
  id = -1;
  width = MIN_PANEL_WIDTH;
  height = Math.max(300, window.innerHeight * 0.6);
  currentComponent: Type<any> | null = null;
  /**
   * Set while an author is choosing which properties the parameterized form offers.
   * Forwarded to the operator frame, which puts a tick box beside each property.
   */
  @Input() exposeChoosing = false;
  /**
   * Whether this panel owns the saved size and position of the operator canvas's panel.
   *
   * The parameterized canvas mounts this same component inside a preview box, where the
   * panel is restyled to sit inline at full width. Letting that copy write the shared
   * keys meant leaving the form view saved the preview's geometry over the real panel's,
   * so the operator canvas came back with an unusable panel. Only the docked panel on
   * the operator canvas persists anything; every other copy is transient.
   */
  @Input() persistPlacement = true;
  /** Set from the toolbar toggle on the operator canvas; the input covers the form view. */
  private choosingFromToolbar = false;

  /** Either the form view asked for tick boxes, or the canvas toolbar toggle is on. */
  /** Only workflows whose author turned the parameterized canvas on offer this. */
  public get offersParameterizedCanvas(): boolean {
    return this.workflowActionService.getWorkflowMetadata()?.isParameterized === true;
  }

  public toggleChoosingParameters(): void {
    this.parameterizationService.setChoosing(!this.parameterizationService.isChoosing());
  }

  public get choosing(): boolean {
    return this.exposeChoosing || this.choosingFromToolbar;
  }
  componentInputs = {};
  dragPosition = { x: 0, y: 0 };
  constructor(
    public workflowActionService: WorkflowActionService,
    private changeDetectorRef: ChangeDetectorRef,
    private panelService: PanelService,
    private parameterizationService: ParameterizationService
  ) {
    // A stored "0" is a truthy string, so a panel that was closed before a reload used
    // to come back closed on every load afterwards -- and the button that reopens it is
    // itself hidden until an operator is selected, so the panel simply looked broken.
    // Anything narrower than the resize minimum is treated as no stored width at all.
    const storedWidth = Number(localStorage.getItem("right-panel-width"));
    if (storedWidth >= MIN_PANEL_WIDTH) this.width = storedWidth;
    this.height = Number(localStorage.getItem("right-panel-height")) || this.height;
  }

  /**
   * The parameterized canvas turns tick boxes on by setting this input, and it flips
   * whenever the author enters or leaves edit mode. The frame builds its formly fields
   * once, so without remounting here the boxes only appeared if the mode was already on
   * when the panel opened -- entering edit mode with a step already selected showed none.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes["exposeChoosing"] && !changes["exposeChoosing"].firstChange) {
      this.remountOperatorFrame();
    }
  }

  ngOnInit(): void {
    if (this.persistPlacement) {
      this.restoreSavedPlacement();
    }
    this.registerHighlightEventsHandler();
    // The toolbar's "choose parameters" toggle lives in the service so both the canvas
    // toolbar and this panel see the same state. Re-emit the frame's inputs when it
    // changes, so tick boxes appear and disappear without needing a re-selection.
    this.parameterizationService.choosing$
      .pipe(distinctUntilChanged(), untilDestroyed(this))
      .subscribe(choosing => {
        const wasChoosing = this.choosingFromToolbar;
        this.choosingFromToolbar = choosing;
        // Only an actual change needs the frame rebuilt. The stream is a BehaviorSubject,
        // so it replays its current value on subscribe; remounting for that would tear
        // the panel down during the page's first change-detection pass.
        if (wasChoosing === choosing || this.currentComponent !== OperatorPropertyEditFrameComponent) {
          return;
        }
        // The frame builds its formly fields once, when it is created, so a new input
        // alone would not add or remove the tick boxes -- it has to be remounted.
        //
        // The restore is in a `finally` and the teardown is not followed by a synchronous
        // detectChanges: an exception from an unrelated component (the workspace throws
        // NG0100 in dev mode) used to abort this method between the two assignments,
        // leaving currentComponent null forever -- and the template hides the whole panel
        // on `!currentComponent`, so the property editor silently disappeared.
        this.remountOperatorFrame();
      });
    this.panelService.closePanelStream.pipe(untilDestroyed(this)).subscribe(() => this.closePanel());
    this.panelService.resetPanelStream.pipe(untilDestroyed(this)).subscribe(() => {
      this.resetPanelPosition();
      this.openPanel();
    });
  }

  /**
   * Put the panel back where it was last left, unless that is somewhere unreachable.
   *
   * The saved value is the container's raw cssText, which carries the drag transform
   * with it. A panel dragged past the edge of the window therefore came back off-screen
   * on every load, and could not be rescued: "reset panels" moved the panel to a home
   * position that was itself derived from that very transform, so it put the panel
   * straight back where it already was. An out-of-bounds placement is dropped instead.
   */
  private restoreSavedPlacement(): void {
    const container = document.getElementById("right-container");
    if (!container) {
      return;
    }
    const saved = localStorage.getItem("right-panel-style");
    if (!saved) {
      return;
    }
    // Restore the drag offset and nothing else. The saved value is the container's whole
    // style attribute, so it also carried layout properties: the parameterized canvas's
    // copy of this panel sits inline in a preview box, and it used to save its own
    // `position: relative` here, which on the operator canvas dropped the docked panel
    // out of the viewport entirely. Width and height have their own keys, and any style
    // already poisoned this way is discarded by being ignored.
    const transform = /transform:\s*([^;]+)/.exec(saved)?.[1]?.trim();
    if (!transform) {
      localStorage.removeItem("right-panel-style");
      return;
    }
    const [xOffset, yOffset, _] = calculateTotalTranslate3d(transform);
    if (this.isOutOfReach(xOffset, yOffset)) {
      localStorage.removeItem("right-panel-style");
      return;
    }
    container.style.transform = transform;
  }

  /** True once a drag offset would leave too little of the panel on screen to grab. */
  private isOutOfReach(xOffset: number, yOffset: number): boolean {
    const keepVisible = 80;
    return (
      Math.abs(xOffset) > Math.max(0, this.window.innerWidth - keepVisible) ||
      Math.abs(yOffset) > Math.max(0, this.window.innerHeight - keepVisible)
    );
  }

  /**
   * Rebuild the operator frame so a changed tick-box mode takes effect. The restore runs
   * from a timer rather than straight after the teardown: an exception thrown by an
   * unrelated component during a synchronous change-detection pass used to abort between
   * the two assignments, leaving currentComponent null and the whole panel hidden.
   */
  private remountOperatorFrame(): void {
    if (this.currentComponent !== OperatorPropertyEditFrameComponent) {
      return;
    }
    const inputs = { ...this.componentInputs, exposeChoosing: this.choosing };
    this.currentComponent = null;
    setTimeout(() => {
      this.componentInputs = inputs;
      this.currentComponent = OperatorPropertyEditFrameComponent;
      this.changeDetectorRef.detectChanges();
    });
  }

  private updateHeightBasedOnContent(): void {
    setTimeout(() => {
      const contentEl = this.contentWrapperRef?.nativeElement;
      if (contentEl) {
        const contentHeight = contentEl.scrollHeight;
        const maxHeight = this.window.innerHeight * 0.6;
        this.height = Math.min(contentHeight + 40, maxHeight);
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  @HostListener("window:beforeunload")
  ngOnDestroy(): void {
    if (!this.persistPlacement) {
      return;
    }
    localStorage.setItem("right-panel-width", String(this.width));
    localStorage.setItem("right-panel-height", String(this.height));

    const rightContainer = document.getElementById("right-container");
    if (rightContainer) {
      // Only the drag offset, collapsed to a single translate. Saving the whole style
      // attribute is what let one view's layout follow the user into another, and saving
      // the raw transform let the translations pile up one per visit.
      const [x, y, z] = calculateTotalTranslate3d(rightContainer.style.transform);
      localStorage.setItem("right-panel-style", `transform: translate3d(${x}px, ${y}px, ${z}px);`);
    }
  }

  /**
   * This method changes the property editor according to how operators are highlighted on the workflow editor.
   *
   * Displays the form of the highlighted operator if only one operator is highlighted;
   * Displays the form of the link breakpoint if only one link is highlighted;
   * hides the form if no operator/link is highlighted or multiple operators and/or groups and/or links are highlighted.
   */
  registerHighlightEventsHandler() {
    merge(
      this.workflowActionService.getJointGraphWrapper().getJointOperatorHighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getJointOperatorUnhighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getJointGroupHighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getJointGroupUnhighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getLinkHighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getLinkUnhighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getJointCommentBoxHighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getJointCommentBoxUnhighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getJointPortHighlightStream(),
      this.workflowActionService.getJointGraphWrapper().getJointPortUnhighlightStream()
    )
      .pipe(
        filter(() => this.workflowActionService.getTexeraGraph().getSyncTexeraGraph()),
        untilDestroyed(this)
      )
      .subscribe(_ => {
        const highlightedOperators = this.workflowActionService
          .getJointGraphWrapper()
          .getCurrentHighlightedOperatorIDs();
        const highlightLinks = this.workflowActionService.getJointGraphWrapper().getCurrentHighlightedLinkIDs();
        this.workflowActionService.getJointGraphWrapper().getCurrentHighlightedCommentBoxIDs();
        const highlightedPorts = this.workflowActionService.getJointGraphWrapper().getCurrentHighlightedPortIDs();

        if (highlightedOperators.length === 1 && highlightLinks.length === 0 && highlightedPorts.length === 0) {
          this.currentComponent = OperatorPropertyEditFrameComponent;
          this.componentInputs = { currentOperatorId: highlightedOperators[0], exposeChoosing: this.choosing };
        } else if (highlightedPorts.length === 1 && highlightLinks.length === 0) {
          this.currentComponent = PortPropertyEditFrameComponent;
          this.componentInputs = { currentPortID: highlightedPorts[0] };
        } else {
          this.currentComponent = null;
          this.componentInputs = {};
          this.workflowActionService.getTexeraGraph().updateSharedModelAwareness("currentlyEditing", undefined);
        }
        this.changeDetectorRef.detectChanges();
        this.updateHeightBasedOnContent();
      });
  }
  onResize({ width, height }: NzResizeEvent) {
    cancelAnimationFrame(this.id);
    this.id = requestAnimationFrame(() => {
      this.width = width!;
      this.height = height!;
    });
  }

  openPanel() {
    this.width = 280;
    this.height = 300;
    this.updateHeightBasedOnContent();
  }

  closePanel() {
    this.width = 0;
    this.height = 65;
  }

  resetPanelPosition() {
    // Reset is the way out of any placement the user cannot undo by hand, so it clears
    // what was saved instead of only moving the panel -- otherwise the next load simply
    // restores the same unreachable position. Home is the docked spot, always.
    localStorage.removeItem("right-panel-style");
    const container = document.getElementById("right-container");
    if (container) {
      container.style.transform = "";
    }
    this.dragPosition = { x: 0, y: 0 };
  }
}
