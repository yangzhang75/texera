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

import { describe, it, expect } from "vitest";
import { customFormlyFieldType, CANVAS_ONLY_FORMLY_TYPES } from "./custom-formly-type";

describe("customFormlyFieldType", () => {
  it("maps a file property to the autocomplete picker", () => {
    expect(customFormlyFieldType({ key: "fileName", operatorType: undefined })).toBe("inputautocomplete");
  });

  it("maps a dataset-version property to the dataset selector", () => {
    expect(customFormlyFieldType({ key: "datasetVersionPath", operatorType: "Any" })).toBe("datasetversionselector");
  });

  it("maps the model-name property to the HuggingFace picker regardless of operator", () => {
    expect(customFormlyFieldType({ key: "huggingFaceModel", operatorType: "SomethingElse" })).toBe("huggingface");
  });

  it("maps modelId to the HuggingFace picker only on a HuggingFace operator", () => {
    expect(customFormlyFieldType({ key: "modelId", operatorType: "HuggingFace" })).toBe("huggingface");
    expect(customFormlyFieldType({ key: "modelId", operatorType: "OtherOp" })).toBeUndefined();
  });

  it("maps the image/audio inputs to their uploaders only on a HuggingFace operator", () => {
    expect(customFormlyFieldType({ key: "imageInput", operatorType: "HuggingFace" })).toBe("huggingface-image-upload");
    expect(customFormlyFieldType({ key: "audioInput", operatorType: "HuggingFace" })).toBe("huggingface-audio-upload");
    expect(customFormlyFieldType({ key: "imageInput", operatorType: "OtherOp" })).toBeUndefined();
    expect(customFormlyFieldType({ key: "audioInput", operatorType: "OtherOp" })).toBeUndefined();
  });

  it("maps a Python-UDF code property to the code editor, but only once it has an editable control", () => {
    expect(
      customFormlyFieldType({
        key: "code",
        operatorType: "PythonUDFV2",
        description: "Input your code here",
        currentType: "textarea",
      })
    ).toBe("codearea");
    // No resolved control yet -> leave it to formly's default.
    expect(
      customFormlyFieldType({
        key: "code",
        operatorType: "PythonUDFV2",
        description: "Input your code here",
        currentType: undefined,
      })
    ).toBeUndefined();
  });

  it("maps Projection attributes to the drag-and-drop repeat section", () => {
    expect(customFormlyFieldType({ key: "attributes", operatorType: "Projection" })).toBe("repeat-section-dnd");
    expect(customFormlyFieldType({ key: "attributes", operatorType: "Filter" })).toBeUndefined();
  });

  it("leaves an ordinary property to formly's default control", () => {
    expect(customFormlyFieldType({ key: "limit", operatorType: "Limit" })).toBeUndefined();
  });

  it("marks the canvas-only widgets that cannot be a form field", () => {
    expect(CANVAS_ONLY_FORMLY_TYPES.has("codearea")).toBe(true);
    expect(CANVAS_ONLY_FORMLY_TYPES.has("repeat-section-dnd")).toBe(true);
    // A value picker/uploader is fine as a form field.
    expect(CANVAS_ONLY_FORMLY_TYPES.has("datasetversionselector")).toBe(false);
    expect(CANVAS_ONLY_FORMLY_TYPES.has("huggingface")).toBe(false);
  });
});
