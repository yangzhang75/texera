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
import {
  AttributeOption,
  AttributeRow,
  availableAttributeOptions,
  findAncestorRows,
} from "./attribute-option-filter.util";

const OPTIONS: AttributeOption[] = [
  { value: "id", label: "id" },
  { value: "name", label: "name" },
  { value: "age", label: "age" },
];

const values = (options: AttributeOption[]): string[] => options.map(o => o.value);

describe("availableAttributeOptions", () => {
  it("returns all options when nothing is selected yet", () => {
    const rows: AttributeRow[] = [{ originalAttribute: "" }, { originalAttribute: "" }];
    expect(values(availableAttributeOptions(OPTIONS, rows, rows[0]))).toEqual(["id", "name", "age"]);
  });

  it("removes attributes selected in other rows", () => {
    const rows: AttributeRow[] = [{ originalAttribute: "id" }, { originalAttribute: "" }];
    // for the second (empty) row, "id" is taken by the first row -> excluded
    expect(values(availableAttributeOptions(OPTIONS, rows, rows[1]))).toEqual(["name", "age"]);
  });

  it("keeps the current row's own selection available", () => {
    const rows: AttributeRow[] = [{ originalAttribute: "id" }, { originalAttribute: "name" }];
    // the first row still sees its own "id", but not "name" (taken by the other row)
    expect(values(availableAttributeOptions(OPTIONS, rows, rows[0]))).toEqual(["id", "age"]);
  });

  it("excludes multiple other-row selections at once", () => {
    const rows: AttributeRow[] = [{ originalAttribute: "id" }, { originalAttribute: "age" }, { originalAttribute: "" }];
    // third row: both "id" and "age" taken -> only "name" left
    expect(values(availableAttributeOptions(OPTIONS, rows, rows[2]))).toEqual(["name"]);
  });

  it("in the duplicate state, each row keeps its own value and still offers the free ones", () => {
    // Two rows both currently "id" (the invalid state we want the user to fix): each row
    // keeps its own "id" (so it stays displayed) and still offers the unused name/age so
    // the user can change one of them to resolve the duplicate. Rows are compared by
    // identity, so a row is never excluded by its own value.
    const rows: AttributeRow[] = [{ originalAttribute: "id" }, { originalAttribute: "id" }];
    expect(values(availableAttributeOptions(OPTIONS, rows, rows[0]))).toEqual(["id", "name", "age"]);
    expect(values(availableAttributeOptions(OPTIONS, rows, rows[1]))).toEqual(["id", "name", "age"]);
  });

  it("ignores blank / null originalAttribute in other rows", () => {
    const rows: AttributeRow[] = [{ originalAttribute: "" }, { originalAttribute: null }, { originalAttribute: "id" }];
    expect(values(availableAttributeOptions(OPTIONS, rows, rows[0]))).toEqual(["name", "age"]);
  });

  it("handles empty / nullish rows input", () => {
    expect(values(availableAttributeOptions(OPTIONS, [], { originalAttribute: "" }))).toEqual(["id", "name", "age"]);
    expect(values(availableAttributeOptions(OPTIONS, null, null))).toEqual(["id", "name", "age"]);
    expect(values(availableAttributeOptions(OPTIONS, undefined, undefined))).toEqual(["id", "name", "age"]);
  });

  it("returns an empty list when every option is taken by other rows", () => {
    const rows: AttributeRow[] = [
      { originalAttribute: "id" },
      { originalAttribute: "name" },
      { originalAttribute: "age" },
      { originalAttribute: "" },
    ];
    expect(values(availableAttributeOptions(OPTIONS, rows, rows[3]))).toEqual([]);
  });
});

describe("findAncestorRows", () => {
  it("returns the nearest ancestor model that is an array", () => {
    const rows: AttributeRow[] = [{ originalAttribute: "id" }];
    const arrayField = { model: rows } as FormlyFieldConfig;
    const rowField = { model: rows[0], parent: arrayField } as FormlyFieldConfig;
    const leafField = { key: "originalAttribute", model: rows[0], parent: rowField } as FormlyFieldConfig;

    // exact same array reference is returned
    expect(findAncestorRows(leafField)).toBe(rows);
  });

  it("returns [] when there is no array ancestor", () => {
    const arrayField = { model: { notAnArray: true }, parent: undefined } as unknown as FormlyFieldConfig;
    const leafField = { model: {}, parent: arrayField } as FormlyFieldConfig;

    expect(findAncestorRows(leafField)).toEqual([]);
  });

  it("returns [] for undefined input", () => {
    expect(findAncestorRows(undefined)).toEqual([]);
  });
});
