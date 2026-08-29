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

import { UntilDestroy } from "@ngneat/until-destroy";
import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from "@angular/core";
import {
  DatasetFileNode,
  getRelativePathFromDatasetFileNode,
} from "../../../../../../common/type/datasetVersionFileTree";
import { ITreeOptions, TREE_ACTIONS, TreeModule } from "@ali-hm/angular-tree-component";
import { NgIf } from "@angular/common";
import { ɵNzTransitionPatchDirective } from "ng-zorro-antd/core/transition-patch";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { NzSpaceCompactItemDirective } from "ng-zorro-antd/space";
import { NzButtonComponent } from "ng-zorro-antd/button";
import { NzTooltipDirective } from "ng-zorro-antd/tooltip";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"] as const;

// The library adds a 2px drop slot after every row, plus one extra leading
// slot before the first row.
const TREE_DROP_SLOT_HEIGHT_PX = 2;

// Container height cap; matches the pre-virtualization max-height.
const MAX_FILE_TREE_CONTAINER_HEIGHT_PX = 200;

// The library throttles viewport re-measures to one per 17ms, leading-edge
// only — a call inside the window is dropped and never re-fired, so
// re-measures must wait out the window.
const TREE_VIEWPORT_REMEASURE_DELAY_MS = 25;

// Total node count across the whole tree, including collapsed descendants.
function countNodes(nodes: DatasetFileNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.children ?? []), 0);
}

@UntilDestroy()
@Component({
  selector: "texera-user-dataset-version-filetree",
  templateUrl: "./user-dataset-version-filetree.component.html",
  styleUrls: ["./user-dataset-version-filetree.component.scss"],
  imports: [
    TreeModule,
    NgIf,
    ɵNzTransitionPatchDirective,
    NzIconDirective,
    NzSpaceCompactItemDirective,
    NzButtonComponent,
    NzTooltipDirective,
  ],
})
export class UserDatasetVersionFiletreeComponent implements AfterViewInit, OnDestroy {
  @Input()
  public isTreeNodeDeletable: boolean = false;

  @Input()
  public set fileTreeNodes(nodes: DatasetFileNode[]) {
    this._fileTreeNodes = nodes ?? [];
    const newHeight = this.computeContainerHeightPx();
    if (newHeight !== this.fileTreeContainerHeightPx) {
      this.fileTreeContainerHeightPx = newHeight;
      // The tree measures its viewport once after init and again only on
      // scroll, so a height change must trigger a re-measure (delayed past
      // the throttle) — otherwise a tree that starts empty stays blank. For
      // the same reason, a host that creates this component hidden must call
      // tree.sizeChanged() on reveal.
      setTimeout(() => this.tree?.sizeChanged(), TREE_VIEWPORT_REMEASURE_DELAY_MS);
    }
  }
  public get fileTreeNodes(): DatasetFileNode[] {
    return this._fileTreeNodes;
  }
  private _fileTreeNodes: DatasetFileNode[] = [];

  @Input()
  public isExpandAllAfterViewInit = false;

  @ViewChild("tree") tree: any;
  @ViewChild("container") private container?: ElementRef<HTMLElement>;

  @Output()
  setCoverImage = new EventEmitter<string>();

  // Row height used by the virtual scroll; the template binds it as
  // --tree-node-height so the SCSS row rules stay in sync with nodeHeight.
  public readonly TREE_NODE_HEIGHT_PX = 24;

  // min(content, 200px); bound in the template so small trees hug their
  // content while the virtual scroll keeps a definite viewport.
  public fileTreeContainerHeightPx = 0;

  // useVirtualScroll keeps only the visible rows in the DOM; without it,
  // hundreds of files freeze the page for seconds to minutes.
  public fileTreeDisplayOptions: ITreeOptions = {
    displayField: "name",
    hasChildrenField: "children",
    useVirtualScroll: true,
    nodeHeight: this.TREE_NODE_HEIGHT_PX,
    actionMapping: {
      mouse: {
        click: (tree: any, node: any, $event: any) => {
          if (node.hasChildren) {
            TREE_ACTIONS.TOGGLE_EXPANDED(tree, node, $event);
          } else {
            this.selectedTreeNode.emit(node.data);
          }
        },
      },
    },
  };

  @Output()
  public selectedTreeNode = new EventEmitter<DatasetFileNode>();

  @Output()
  public deletedTreeNode = new EventEmitter<DatasetFileNode>();

  private revealObserver?: ResizeObserver;
  private lastObservedWidthPx = 0;

  constructor() {}

  onNodeDeleted(node: DatasetFileNode): void {
    this.deletedTreeNode.emit(node);
  }

  ngAfterViewInit(): void {
    if (this.isExpandAllAfterViewInit) {
      this.tree.treeModel.expandAll();
    }
    this.remeasureOnReveal();
  }

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
  }

  /**
   * Re-measure the virtual-scroll viewport the first time this component is
   * actually on screen.
   *
   * The library measures the viewport once after init and again only on scroll.
   * A host that creates the component hidden -- the dataset page builds it inside
   * the "Versions & Files" tab while "Data Card" is the open one -- therefore
   * measures a zero-height viewport, decides no rows are visible, and renders an
   * empty tree forever: the files are loaded, the container is the right height,
   * and not one node is drawn. Scrolling does not rescue it either, because with
   * no rows there is nothing to scroll.
   *
   * Watching the box means every host gets this for free rather than each one
   * having to remember to call `sizeChanged()` on reveal.
   */
  private remeasureOnReveal(): void {
    const element = this.container?.nativeElement;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    this.revealObserver = new ResizeObserver(entries => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      const wasHidden = this.lastObservedWidthPx === 0;
      this.lastObservedWidthPx = width;
      if (wasHidden && width > 0) {
        // Past the library's 17ms leading-edge throttle, as above.
        setTimeout(() => this.tree?.sizeChanged(), TREE_VIEWPORT_REMEASURE_DELAY_MS);
      }
    });
    this.revealObserver.observe(element);
  }

  isImageFile(fileName: string): boolean {
    return IMAGE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));
  }

  // countNodes includes collapsed descendants, so a partially collapsed tree
  // may get a slightly taller container — still bounded by the cap.
  private computeContainerHeightPx(): number {
    const nodeCount = countNodes(this._fileTreeNodes);
    if (nodeCount === 0) {
      return 0;
    }
    const contentHeightPx =
      nodeCount * (this.TREE_NODE_HEIGHT_PX + TREE_DROP_SLOT_HEIGHT_PX) + TREE_DROP_SLOT_HEIGHT_PX;
    return Math.min(contentHeightPx, MAX_FILE_TREE_CONTAINER_HEIGHT_PX);
  }

  onSetCover(nodeData: DatasetFileNode): void {
    this.setCoverImage.emit(getRelativePathFromDatasetFileNode(nodeData));
  }
}
