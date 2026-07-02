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

/** A Formly select option ({ value, label }). */
export interface AttributeOption {
  value: string;
  label?: string;
}

/** One row of the Projection operator's attribute list (an AttributeUnit). */
export interface AttributeRow {
  originalAttribute?: string | null;
  alias?: string | null;
}

/**
 * The attribute options a single Projection row should offer: the full list minus the
 * source attributes already selected in the *other* rows. The current row keeps its own
 * selection (so it stays displayable and re-selectable), and only other rows' picks are
 * removed — this prevents choosing the same source attribute twice, which would produce
 * duplicate output columns and make the workflow fail to run.
 *
 * Pure and framework-free so it can be unit-tested directly; the Formly wiring only feeds
 * it the full option list, all rows, and the current row.
 */
export function availableAttributeOptions(
  allOptions: ReadonlyArray<AttributeOption>,
  rows: ReadonlyArray<AttributeRow | null | undefined> | null | undefined,
  currentRow: AttributeRow | null | undefined
): AttributeOption[] {
  const selectedElsewhere = new Set<string>();
  for (const row of rows ?? []) {
    if (row === currentRow || row == null) {
      continue;
    }
    const picked = row.originalAttribute;
    if (typeof picked === "string" && picked !== "") {
      selectedElsewhere.add(picked);
    }
  }

  const ownValue = currentRow?.originalAttribute;
  return allOptions.filter(option => option.value === ownValue || !selectedElsewhere.has(option.value));
}

/**
 * Walk up the Formly field tree from a leaf field to the nearest ancestor whose model is
 * an array, and return that array (the Projection attribute rows). Walking up to the first
 * array model — rather than assuming a fixed parent depth — keeps this robust to how the
 * array/object field nesting is built. Returns [] if no array ancestor is found.
 */
export function findAncestorRows(field: FormlyFieldConfig | undefined): AttributeRow[] {
  let current = field;
  while (current) {
    if (Array.isArray(current.model)) {
      return current.model as AttributeRow[];
    }
    current = current.parent;
  }
  return [];
}
