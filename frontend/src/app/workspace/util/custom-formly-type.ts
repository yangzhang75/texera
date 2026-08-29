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

/**
 * The custom formly widget an operator-schema property renders as, decided from the
 * property key and its operator. Single source of truth shared by the operator property
 * panel and the parameterized canvas, so a control registered for one surfaces in the
 * other and a selectable/uploadable property never silently degrades to a plain text box.
 *
 * Returns undefined to keep formly's default control (string/number/textarea/...). Only
 * the widget TYPE lives here; each caller keeps its own field behaviour (the panel's
 * task-driven hide/validators, the canvas's per-field wiring).
 */
export function customFormlyFieldType(input: {
  key: unknown;
  operatorType: string | undefined;
  description?: string;
  /** formly's already-resolved type; the code box only replaces an editable control. */
  currentType?: unknown;
}): string | undefined {
  const { key, operatorType, description, currentType } = input;

  if (key === "fileName") {
    return "inputautocomplete";
  }
  if (key === "huggingFaceModel") {
    return "huggingface";
  }
  if (key === "modelId" && operatorType === "HuggingFace") {
    return "huggingface";
  }
  if (key === "imageInput" && operatorType === "HuggingFace") {
    return "huggingface-image-upload";
  }
  if (key === "audioInput" && operatorType === "HuggingFace") {
    return "huggingface-audio-upload";
  }
  if (key === "datasetVersionPath") {
    return "datasetversionselector";
  }
  // Python UDF script box: only when the schema already resolved to an editable control.
  if (description?.toLowerCase() === "input your code here" && currentType) {
    return "codearea";
  }
  if (operatorType === "Projection" && key === "attributes") {
    return "repeat-section-dnd";
  }
  return undefined;
}
