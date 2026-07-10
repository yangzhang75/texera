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

import { AfterContentInit, Component, ElementRef, Input, ViewChild } from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import { WorkflowResultService } from "../../service/workflow-result/workflow-result.service";
import { PanelResizeService } from "../../service/workflow-result/panel-resize/panel-resize.service";
import { auditTime, filter } from "rxjs/operators";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";

@UntilDestroy()
@Component({
  selector: "texera-visualization-panel-content",
  templateUrl: "./visualization-frame-content.component.html",
  styleUrls: ["./visualization-frame-content.component.scss"],
})
export class VisualizationFrameContentComponent implements AfterContentInit {
  // operatorId: string = inject(NZ_MODAL_DATA).operatorId;
  @Input() operatorId?: string;
  @ViewChild("htmlContent") iframe?: ElementRef<HTMLIFrameElement>;
  // progressive visualization update and redraw interval in milliseconds
  public static readonly UPDATE_INTERVAL_MS = 2000;
  htmlData: any = "";

  constructor(
    private workflowResultService: WorkflowResultService,
    private sanitizer: DomSanitizer,
    private panelResizeService: PanelResizeService
  ) {}

  ngAfterContentInit() {
    // attempt to draw chart immediately
    this.drawChart();

    // setup an event lister that re-draws the chart content every (n) milliseconds
    // auditTime makes sure the first re-draw happens after (n) milliseconds has elapsed
    this.workflowResultService
      .getResultUpdateStream()
      .pipe(auditTime(VisualizationFrameContentComponent.UPDATE_INTERVAL_MS))
      .pipe(filter(rec => this.operatorId !== undefined && rec[this.operatorId] !== undefined))
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        this.drawChart();
      });

    // The chart lives in an iframe whose container follows the result panel, but Plotly figures
    // are emitted at a fixed pixel size, so growing/shrinking the panel would clip them instead
    // of scaling them. Re-fit the chart on every panel-size change so it tracks the panel.
    this.panelResizeService.currentSize
      .pipe(auditTime(100))
      .pipe(untilDestroyed(this))
      .subscribe(() => this.fitChartToPanel());
  }

  /**
   * Make the embedded Plotly chart fill (and follow) the iframe. The srcdoc iframe is same-origin,
   * so its window — and the `Plotly` global loaded inside it — is directly reachable. We stretch the
   * graph div to 100% and call `Plotly.Plots.resize`, which recomputes the plot to its container's
   * current size (the same trick Plotly's own responsive mode uses on window resize). No-op until the
   * chart has actually rendered, so it's safe to call on load and on every resize tick.
   */
  fitChartToPanel() {
    const win = this.iframe?.nativeElement?.contentWindow as any;
    const plotly = win?.Plotly;
    const graphDiv = win?.document?.querySelector(".plotly-graph-div") as HTMLElement | null;
    if (!plotly?.Plots || !graphDiv) {
      return;
    }
    graphDiv.style.width = "100%";
    graphDiv.style.height = "100%";
    plotly.Plots.resize(graphDiv);
  }
  drawChart() {
    if (!this.operatorId) {
      return;
    }
    const operatorResultService = this.workflowResultService.getResultService(this.operatorId);
    if (!operatorResultService) {
      return;
    }
    const data = operatorResultService.getCurrentResultSnapshot();
    if (!data) {
      return;
    }

    const parser = new DOMParser();
    const lastData = data[data.length - 1];
    const doc = parser.parseFromString(Object(lastData)["html-content"], "text/html");

    doc.documentElement.style.height = "100%";
    doc.body.style.height = "95%";

    const firstDiv = doc.body.querySelector("div");
    if (firstDiv) firstDiv.style.height = "100%";

    // Make the rendered result scale with the iframe (hence the result panel). Operators emit
    // either a static <img> (e.g. a scanpy/matplotlib plot) or an interactive Plotly div. This
    // CSS makes an image grow/shrink with the panel width (keeping aspect ratio) and lets a Plotly
    // div fill the panel; for Plotly we also call Plotly.Plots.resize (fitChartToPanel) so it
    // redraws to the new size. CSS has no <, >, or & so it survives XMLSerializer untouched.
    const style = doc.createElement("style");
    style.textContent =
      "img{width:100%!important;height:auto!important;display:block;}" +
      ".plotly-graph-div,.js-plotly-plot{width:100%!important;height:100%!important;}";
    doc.head.appendChild(style);

    const serializer = new XMLSerializer();
    const newHtmlString = serializer.serializeToString(doc);

    this.htmlData = this.sanitizer.bypassSecurityTrustHtml(newHtmlString); // this line bypasses angular security
  }
}
