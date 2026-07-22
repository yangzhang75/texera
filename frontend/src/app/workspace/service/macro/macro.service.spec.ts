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

import { MacroService, MacroDetail } from "./macro.service";

// Operator types treated as sources (0 input ports) by the stub metadata.
const SOURCE_TYPES = new Set(["CSVFileScan", "Source"]);

// Minimal OperatorMetadataService stub: a source op has 0 input ports, every
// other known op has 1; unknown types throw (mirrors the real getOperatorSchema).
const metadataStub = {
  getOperatorSchema: (operatorType: string) => {
    if (operatorType !== "Filter" && operatorType !== "Projection" && !SOURCE_TYPES.has(operatorType)) {
      throw new Error(`unknown operator ${operatorType}`);
    }
    return {
      operatorType,
      jsonSchema: {},
      operatorVersion: "",
      additionalMetadata: {
        userFriendlyName: operatorType,
        operatorGroupName: SOURCE_TYPES.has(operatorType) ? "Source" : "Analysis",
        inputPorts: SOURCE_TYPES.has(operatorType) ? [] : [{ displayName: "in" }],
        outputPorts: [{ displayName: "out" }],
      },
    };
  },
} as any;

function makeService(): MacroService {
  // isMacroRunnable + macroDetailToGeneratedContent only touch `this` methods
  // and the injected OperatorMetadataService, so the other deps can be stubs.
  return new MacroService({} as any, {} as any, {} as any, metadataStub);
}

// A MacroBody with input marker -> Filter -> Projection -> output marker.
function macroDetailWithMarkers(): MacroDetail {
  const content = JSON.stringify({
    operators: [
      { operatorID: "MacroInput-0", operatorType: "MacroInput", portIndex: 0, outputPorts: [{ portID: "output-0" }] },
      {
        operatorID: "Filter-1",
        operatorType: "Filter",
        inputPorts: [{ portID: "input-0" }],
        outputPorts: [{ portID: "output-0" }],
      },
      {
        operatorID: "Projection-2",
        operatorType: "Projection",
        inputPorts: [{ portID: "input-0" }],
        outputPorts: [{ portID: "output-0" }],
      },
      { operatorID: "MacroOutput-3", operatorType: "MacroOutput", portIndex: 0, inputPorts: [{ portID: "input-0" }] },
    ],
    links: [
      { fromOpId: "MacroInput-0", fromPortId: { id: 0 }, toOpId: "Filter-1", toPortId: { id: 0 } },
      { fromOpId: "Filter-1", fromPortId: { id: 0 }, toOpId: "Projection-2", toPortId: { id: 0 } },
      { fromOpId: "Projection-2", fromPortId: { id: 0 }, toOpId: "MacroOutput-3", toPortId: { id: 0 } },
    ],
    inputs: [{ index: 0 }],
    outputs: [{ index: 0 }],
  });
  return {
    wid: 1,
    name: "m",
    description: "",
    content,
    creationTime: "2026-01-01T00:00:00Z",
    lastModifiedTime: "2026-01-01T00:00:00Z",
    isPublic: false,
    portSpec: { inputs: [], outputs: [] },
    paramSpec: [],
    isOwner: true,
    readonly: false,
  } as MacroDetail;
}

describe("MacroService.isMacroRunnable", () => {
  const service = makeService();

  it("is runnable when there are no external inputs AND a body source op", () => {
    expect(service.isMacroRunnable(0, ["CSVFileScan", "Filter"])).toBe(true);
  });

  it("is NOT runnable when there are no external inputs but no source op (the gate's whole point)", () => {
    expect(service.isMacroRunnable(0, ["Filter", "Projection"])).toBe(false);
  });

  it("is NOT runnable when the macro has unbound external inputs, even with a source op", () => {
    expect(service.isMacroRunnable(1, ["CSVFileScan"])).toBe(false);
  });

  it("never counts MacroInput/MacroOutput markers as sources", () => {
    expect(service.isMacroRunnable(0, ["MacroInput", "MacroOutput"])).toBe(false);
  });

  it("treats unknown operator types (metadata not loaded) as non-source", () => {
    expect(service.isMacroRunnable(0, ["TotallyUnknownOp"])).toBe(false);
  });
});

describe("MacroService.macroDetailToGeneratedContent", () => {
  const service = makeService();

  it("strips MacroInput/MacroOutput markers from the generated workflow", () => {
    const content = service.macroDetailToGeneratedContent(macroDetailWithMarkers());
    const types = content.operators.map(o => o.operatorType);
    expect(types).toEqual(["Filter", "Projection"]);
    expect(types).not.toContain("MacroInput");
    expect(types).not.toContain("MacroOutput");
  });

  it("drops links that touched a marker but keeps links between kept operators", () => {
    const content = service.macroDetailToGeneratedContent(macroDetailWithMarkers());
    // Only Filter -> Projection survives; the two marker-touching links are gone.
    expect(content.links.length).toBe(1);
    expect(content.links[0].source.operatorID).toBe("Filter-1");
    expect(content.links[0].target.operatorID).toBe("Projection-2");
  });
});
