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

import { FormlyFieldConfig } from "@ngx-formly/core";
import { ParameterizedCanvasComponent } from "./parameterized-canvas.component";
import { ParameterBinding } from "../../../common/type/workflow";

/**
 * The author renames and hides the fields *inside* one input. Finding those fields means
 * walking what formly built, which is shaped three different ways depending on the
 * property: a plain box, an object, or a repeated section whose row template may be a
 * value or a function. Each of those has already been got wrong once.
 */
describe("sub-fields of a parameter", () => {
  const binding = (fields?: ParameterBinding["fields"]): ParameterBinding => ({
    id: "b1",
    operatorID: "op-1",
    propertyKey: "pairs",
    displayName: "Pairs",
    fields,
  });

  const collect = (field: FormlyFieldConfig, b = binding()) =>
    (ParameterizedCanvasComponent.prototype as any).collectSubFields.call({}, [field], b);

  describe("paths", () => {
    // Relative to the property the binding names, so `value` covers pairs.value.
    it("joins nested keys", () => {
      expect(ParameterizedCanvasComponent.childPath("pairs", "key")).toBe("pairs.key");
      expect(ParameterizedCanvasComponent.childPath("", "value")).toBe("value");
    });

    // Every row of a repeated section is the same field; one decision covers them all.
    it("drops array indices so every row shares one decision", () => {
      expect(ParameterizedCanvasComponent.childPath("pairs", "0")).toBe("pairs");
      expect(ParameterizedCanvasComponent.childPath("pairs", "12")).toBe("pairs");
    });

    it("ignores keys that are not names", () => {
      expect(ParameterizedCanvasComponent.childPath("pairs", undefined)).toBe("pairs");
      expect(ParameterizedCanvasComponent.childPath("", "key")).toBe("key");
    });
  });

  describe("finding the row template of a repeated section", () => {
    it("takes it directly when it is a value", () => {
      const item = { key: "row" };
      expect(ParameterizedCanvasComponent.arrayItemOf({ fieldArray: item })).toBe(item);
    });

    // This is what made array properties look like leaves and list nothing at all.
    it("calls it when formly supplies a builder", () => {
      const item = { key: "row" };
      expect(ParameterizedCanvasComponent.arrayItemOf({ fieldArray: () => item })).toBe(item);
    });

    it("gives up quietly on a builder it cannot call", () => {
      const throwing = () => {
        throw new Error("needs a real field");
      };
      expect(ParameterizedCanvasComponent.arrayItemOf({ fieldArray: throwing as never })).toBeUndefined();
    });

    it("has nothing to offer when there is no array", () => {
      expect(ParameterizedCanvasComponent.arrayItemOf({ key: "plain" })).toBeUndefined();
    });
  });

  describe("collecting what a reader types into", () => {
    it("lists the fields of a repeated section, whichever shape it has", () => {
      const row = {
        fieldGroup: [
          { key: "key", props: { label: "Key" } },
          { key: "value", props: { label: "Value" } },
        ],
      };
      for (const fieldArray of [row, () => row]) {
        const rows = collect({ key: "pairs", fieldArray } as FormlyFieldConfig);
        // Paths are relative to the property: the binding already says which property.
        expect(rows.map((r: any) => r.path)).toEqual(["key", "value"]);
        expect(rows.map((r: any) => r.label)).toEqual(["Key", "Value"]);
      }
    });

    // A single-box input has nothing inside it worth listing separately.
    it("lists nothing for a plain input", () => {
      expect(collect({ key: "tableName", props: { label: "table name" } } as FormlyFieldConfig)).toEqual([]);
    });

    it("carries the author's own name and hidden flag", () => {
      const field = {
        key: "pairs",
        fieldArray: { fieldGroup: [{ key: "value", props: { label: "Value" } }] },
      } as FormlyFieldConfig;

      const rows = collect(field, binding({ value: { displayName: "Amount", hidden: true } }));

      expect(rows[0].name).toBe("Amount");
      expect(rows[0].hidden).toBe(true);
      // the schema's own label is still offered as the placeholder
      expect(rows[0].label).toBe("Value");
    });

    // Two rows of the same section are the same field, not two.
    it("does not list a field once per row", () => {
      const field = {
        key: "pairs",
        fieldGroup: [
          { key: "0", fieldGroup: [{ key: "key", props: { label: "Key" } }] },
          { key: "1", fieldGroup: [{ key: "key", props: { label: "Key" } }] },
        ],
      } as FormlyFieldConfig;

      expect(collect(field).map((r: any) => r.path)).toEqual(["key"]);
    });
  });
});
