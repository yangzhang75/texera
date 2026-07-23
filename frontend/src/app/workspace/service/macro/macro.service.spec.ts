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

// jsonSchema.properties per known type, for configurableCandidates filtering.
const SCHEMA_PROPS: Record<string, any> = {
  MixedOp: {
    condition: { type: "string" },
    limit: { type: "integer" },
    keep: { type: "boolean" },
    attr: { type: "string", autofill: "attributeName" }, // upstream-dependent -> excluded
    cfg: { type: "object" }, // complex -> excluded
    tags: { type: "array" }, // complex -> excluded
  },
  Filter: { condition: { type: "string" } },
  Projection: {},
};

// Minimal OperatorMetadataService stub: a source op has 0 input ports, every
// other known op has 1; unknown types throw (mirrors the real getOperatorSchema).
const metadataStub = {
  getOperatorSchema: (operatorType: string) => {
    if (!(operatorType in SCHEMA_PROPS) && !SOURCE_TYPES.has(operatorType)) {
      throw new Error(`unknown operator ${operatorType}`);
    }
    return {
      operatorType,
      jsonSchema: { properties: SCHEMA_PROPS[operatorType] ?? {} },
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

function makeService(http: any = {}): MacroService {
  // isMacroRunnable + macroDetailToGeneratedContent + configurableCandidates only
  // touch `this` methods and the injected OperatorMetadataService, so the other
  // deps can be stubs.
  return new MacroService(http, {} as any, {} as any, metadataStub);
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

describe("MacroService.workflowContentToMacroBody", () => {
  const service = makeService();
  const content: any = {
    operators: [
      {
        operatorID: "MacroInput-0",
        operatorType: "MacroInput",
        operatorProperties: { portIndex: 0 },
        inputPorts: [],
        outputPorts: [{ portID: "output-0" }],
      },
      {
        operatorID: "Filter-1",
        operatorType: "Filter",
        operatorProperties: { condition: "x" },
        configurableProperties: ["condition"],
        inputPorts: [{ portID: "input-0" }],
        outputPorts: [{ portID: "output-0" }],
      },
      {
        operatorID: "MacroOutput-2",
        operatorType: "MacroOutput",
        operatorProperties: { portIndex: 0 },
        inputPorts: [{ portID: "input-0" }],
        outputPorts: [],
      },
    ],
    operatorPositions: {},
    links: [
      { linkID: "l1", source: { operatorID: "MacroInput-0", portID: "output-0" }, target: { operatorID: "Filter-1", portID: "input-0" } },
      { linkID: "l2", source: { operatorID: "Filter-1", portID: "output-0" }, target: { operatorID: "MacroOutput-2", portID: "input-0" } },
    ],
    commentBoxes: [],
    settings: {},
  };

  it("flattens operatorProperties back to top-level body-operator fields", () => {
    const body = service.workflowContentToMacroBody(content);
    expect(body.operators).toHaveLength(3);
    const filter = body.operators.find((o: any) => o.operatorID === "Filter-1") as any;
    expect(filter.condition).toBe("x"); // flattened out of operatorProperties
    expect(filter.operatorType).toBe("Filter");
  });

  it("preserves the configurableProperties whitelist as a top-level body field", () => {
    const body = service.workflowContentToMacroBody(content);
    const filter = body.operators.find((o: any) => o.operatorID === "Filter-1") as any;
    expect(filter.configurableProperties).toEqual(["condition"]);
  });

  it("maps links to MacroLinks with port ordinals parsed from portIDs", () => {
    const body = service.workflowContentToMacroBody(content);
    expect(body.links).toHaveLength(2);
    expect(body.links[0]).toMatchObject({
      fromOpId: "MacroInput-0",
      fromPortId: { id: 0 },
      toOpId: "Filter-1",
      toPortId: { id: 0 },
    });
  });

  it("derives inputs/outputs from the MacroInput/MacroOutput markers", () => {
    const body = service.workflowContentToMacroBody(content);
    expect(body.inputs).toEqual([{ index: 0 }]);
    expect(body.outputs).toEqual([{ index: 0 }]);
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
