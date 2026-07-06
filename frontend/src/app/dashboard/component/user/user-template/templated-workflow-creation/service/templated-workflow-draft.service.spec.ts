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

import { TemplatedWorkflowDraftService } from "./templated-workflow-draft.service";
import { WorkflowContent } from "../../../../../../common/type/workflow";
import { OperatorSchema } from "../../../../../../workspace/types/operator-schema.interface";

/** Minimal WorkflowContent with just the fields the draft service reads (operatorID + properties). */
function makeContent(operators: { operatorID: string; operatorProperties: Record<string, any> }[]): WorkflowContent {
  return { operators } as unknown as WorkflowContent;
}

describe("TemplatedWorkflowDraftService", () => {
  let service: TemplatedWorkflowDraftService;

  beforeEach(() => {
    service = new TemplatedWorkflowDraftService();
  });

  describe("initialize", () => {
    it("seeds operator properties from the content and clears dynamic schemas", () => {
      service.draftDynamicSchemas.set("stale", {} as OperatorSchema);

      service.initialize(makeContent([{ operatorID: "Limit-op-1", operatorProperties: { limit: 2 } }]));

      expect(service.getOperatorProperties("Limit-op-1")).toEqual({ limit: 2 });
      expect(service.hasDraftDynamicSchema("stale")).toBe(false);
    });

    it("deep-clones properties so mutating the draft does not touch the source content", () => {
      const content = makeContent([{ operatorID: "op", operatorProperties: { nested: { a: 1 } } }]);
      service.initialize(content);

      service.getOperatorProperties("op").nested.a = 999;

      expect((content.operators[0].operatorProperties as any).nested.a).toBe(1);
    });
  });

  describe("seedValuesFromContent", () => {
    it("overwrites property values with the workflow's last-applied content", () => {
      service.initialize(makeContent([{ operatorID: "Limit-op-1", operatorProperties: { limit: 2 } }]));

      // Simulate reopening a workflow whose content already holds the last-applied value (88).
      service.seedValuesFromContent(makeContent([{ operatorID: "Limit-op-1", operatorProperties: { limit: 88 } }]));

      expect(service.getOperatorProperties("Limit-op-1")).toEqual({ limit: 88 });
    });

    it("keeps enriched dynamic schemas intact (so attribute dropdowns stay dropdowns)", () => {
      service.initialize(makeContent([{ operatorID: "op", operatorProperties: {} }]));
      service.draftDynamicSchemas.set("op", { schemaKey: "enriched" } as unknown as OperatorSchema);

      service.seedValuesFromContent(makeContent([{ operatorID: "op", operatorProperties: { x: 1 } }]));

      expect(service.hasDraftDynamicSchema("op")).toBe(true);
    });
  });

  describe("operatorPropertiesChanged", () => {
    beforeEach(() => {
      service.initialize(makeContent([{ operatorID: "op", operatorProperties: { limit: 2 } }]));
    });

    it("returns false when the given properties match the draft", () => {
      expect(service.operatorPropertiesChanged("op", { limit: 2 })).toBe(false);
    });

    it("returns true when the given properties differ from the draft", () => {
      expect(service.operatorPropertiesChanged("op", { limit: 9 })).toBe(true);
    });
  });

  describe("mergeSectionModel", () => {
    it("merges new form values over existing properties without dropping untouched keys", () => {
      service.initialize(makeContent([{ operatorID: "op", operatorProperties: { limit: 2, offset: 0 } }]));

      service.mergeSectionModel("op", { limit: 88 });

      expect(service.getOperatorProperties("op")).toEqual({ limit: 88, offset: 0 });
    });

    it("stores a deep clone so later mutations of the passed model do not leak in", () => {
      service.initialize(makeContent([{ operatorID: "op", operatorProperties: {} }]));
      const model = { nested: { a: 1 } };

      service.mergeSectionModel("op", model);
      model.nested.a = 999;

      expect(service.getOperatorProperties("op")).toEqual({ nested: { a: 1 } });
    });
  });

  describe("mergeSectionModelIfChanged", () => {
    beforeEach(() => {
      service.initialize(makeContent([{ operatorID: "op", operatorProperties: { limit: 2 } }]));
    });

    it("returns true and applies the change when the model differs", () => {
      expect(service.mergeSectionModelIfChanged("op", { limit: 9 })).toBe(true);
      expect(service.getOperatorProperties("op")).toEqual({ limit: 9 });
    });

    it("returns false and leaves the draft untouched when nothing changed", () => {
      expect(service.mergeSectionModelIfChanged("op", { limit: 2 })).toBe(false);
      expect(service.getOperatorProperties("op")).toEqual({ limit: 2 });
    });
  });
});
