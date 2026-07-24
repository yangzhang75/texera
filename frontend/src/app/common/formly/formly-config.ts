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

import { NullTypeComponent } from "./null.type";
import { ArrayTypeComponent } from "./array.type";
import { ObjectTypeComponent } from "./object.type";
import { MultiSchemaTypeComponent } from "./multischema.type";
import { FormlyFieldConfig } from "@ngx-formly/core";
import { CodeareaCustomTemplateComponent } from "../../workspace/component/codearea-custom-template/codearea-custom-template.component";
import { PresetWrapperComponent } from "./preset-wrapper/preset-wrapper.component";
import { DatasetFileSelectorComponent } from "../../workspace/component/dataset-file-selector/dataset-file-selector.component";
import { CollabWrapperComponent } from "./collab-wrapper/collab-wrapper/collab-wrapper.component";
import { FormlyRepeatDndComponent } from "./repeat-dnd/repeat-dnd.component";
import { UiUdfParametersComponent } from "../../workspace/component/ui-udf-parameters/ui-udf-parameters.component";
import { DatasetVersionSelectorComponent } from "../../workspace/component/dataset-version-selector/dataset-version-selector.component";
import { HuggingFaceImageUploadComponent } from "../../workspace/component/hugging-face-image-upload/hugging-face-image-upload.component";
import { HuggingFaceComponent } from "../../workspace/component/hugging-face/hugging-face.component";
import { HuggingFaceAudioUploadComponent } from "../../workspace/component/hugging-face-audio-upload/hugging-face-audio-upload.component";
import { ConfigurablePropertyWrapperComponent } from "../../workspace/component/property-editor/operator-property-edit-frame/configurable-property-wrapper/configurable-property-wrapper.component";

function toNumberOrNull(val: any): number | null {
  if (val === "" || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

/**
 * Null-safe replacement for FormlyJsonschema's built-in number/integer parser.
 *
 * The stock parser (ngx-formly-core-json-schema) does
 * `document.querySelector('#'+f.id).validity.badInput` when the value clears.
 * That assumes `f.id` is a native <input>, but ng-zorro's nz-input-number puts
 * the id on the WRAPPER (the native input has no id), so `.validity` is
 * undefined and it throws "Cannot read properties of undefined (reading
 * 'badInput')", taking down the whole form on the first cleared/typed digit.
 *
 * This variant resolves the real native input (looking inside the wrapper) and
 * guards `validity`; behavior is otherwise identical (badInput -> keep the raw
 * mid-typing value; genuinely empty -> clear to undefined).
 */
function nullSafeNumberParser(v: any, f?: FormlyFieldConfig): any {
  let num: any = toNumberOrNull(v);
  if (num === null && f) {
    const el = typeof document !== "undefined" && f.id ? document.querySelector(`#${f.id}`) : null;
    const nativeInput = el instanceof HTMLInputElement ? el : ((el?.querySelector?.("input") as HTMLInputElement) ?? null);
    num = nativeInput?.validity?.badInput === true ? v : undefined;
    if (f.formControl && num !== f.formControl.value) {
      f.formControl.setValue(num, { emitModelToViewChange: false });
    }
  }
  return num;
}

/**
 * Configuration for using Json Schema with Formly.
 * This config is copy-pasted from official documentation,
 * see https://formly.dev/examples/advanced/json-schema
 */
export const TEXERA_FORMLY_CONFIG = {
  // App-wide guard: swap FormlyJsonschema's crash-prone number parser for a
  // null-safe one on every number/integer field (see nullSafeNumberParser).
  extensions: [
    {
      name: "texera-number-parser-guard",
      extension: {
        postPopulate(field: FormlyFieldConfig): void {
          if ((field.type === "number" || field.type === "integer") && Array.isArray(field.parsers)) {
            field.parsers = [nullSafeNumberParser];
          }
        },
      },
    },
  ],
  validationMessages: [
    { name: "required", message: "This field is required" },
    { name: "null", message: "should be null" },
    { name: "minLength", message: minlengthValidationMessage },
    { name: "maxLength", message: maxlengthValidationMessage },
    { name: "min", message: minValidationMessage },
    { name: "max", message: maxValidationMessage },
    { name: "multipleOf", message: multipleOfValidationMessage },
    { name: "exclusiveMinimum", message: exclusiveMinimumValidationMessage },
    { name: "exclusiveMaximum", message: exclusiveMaximumValidationMessage },
    { name: "minItems", message: minItemsValidationMessage },
    { name: "maxItems", message: maxItemsValidationMessage },
    { name: "uniqueItems", message: "should NOT have duplicate items" },
    { name: "const", message: constValidationMessage },
  ],
  types: [
    { name: "string", extends: "input", defaultOptions: { defaultValue: "" } },
    {
      name: "number",
      extends: "input",
      defaultOptions: {
        templateOptions: {
          type: "number",
        },
      },
    },
    {
      name: "integer",
      extends: "input",
      defaultOptions: {
        templateOptions: {
          type: "number",
        },
      },
    },
    { name: "boolean", extends: "checkbox" },
    { name: "enum", extends: "select" },
    { name: "null", component: NullTypeComponent, wrappers: ["form-field"] },
    { name: "array", component: ArrayTypeComponent },
    { name: "object", component: ObjectTypeComponent },
    { name: "multischema", component: MultiSchemaTypeComponent },
    { name: "codearea", component: CodeareaCustomTemplateComponent },
    { name: "inputautocomplete", component: DatasetFileSelectorComponent, wrappers: ["form-field"] },
    { name: "datasetversionselector", component: DatasetVersionSelectorComponent, wrappers: ["form-field"] },
    { name: "huggingface", component: HuggingFaceComponent, wrappers: ["form-field"] },
    { name: "huggingface-audio-upload", component: HuggingFaceAudioUploadComponent, wrappers: ["form-field"] },
    { name: "huggingface-image-upload", component: HuggingFaceImageUploadComponent, wrappers: ["form-field"] },
    { name: "repeat-section-dnd", component: FormlyRepeatDndComponent },
    { name: "ui-udf-parameters", component: UiUdfParametersComponent, wrappers: ["form-field"] },
  ],
  wrappers: [
    { name: "preset-wrapper", component: PresetWrapperComponent },
    { name: "collab-wrapper", component: CollabWrapperComponent },
    { name: "configurable-property-wrapper", component: ConfigurablePropertyWrapperComponent },
  ],
};

export function minItemsValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should NOT have fewer than ${field.props?.minItems} items`;
}

export function maxItemsValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should NOT have more than ${field.props?.maxItems} items`;
}

export function minlengthValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should NOT be shorter than ${field.props?.minLength} characters`;
}

export function maxlengthValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should NOT be longer than ${field.props?.maxLength} characters`;
}

export function minValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should be >= ${field.props?.min}`;
}

export function maxValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should be <= ${field.props?.max}`;
}

export function multipleOfValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should be multiple of ${field.props?.step}`;
}

export function exclusiveMinimumValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should be > ${field.props?.exclusiveMinimum}`;
}

export function exclusiveMaximumValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should be < ${field.props?.exclusiveMaximum}`;
}

export function constValidationMessage(err: any, field: FormlyFieldConfig) {
  return `should be equal to constant "${field.props?.const}"`;
}
