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

import { Component } from "@angular/core";
import { NgIf } from "@angular/common";
import { NzIconDirective } from "ng-zorro-antd/icon";
import { FieldWrapper, FormlyFieldConfig } from "@ngx-formly/core";
import { merge } from "lodash-es";

/**
 * Lets an author rename or hide one field of a parameterized form, in place.
 *
 * The label a reader sees comes from the operator's schema, which is written to describe
 * the operator rather than to ask a person for something: "File Key", "Alias". The author
 * knows what to call it for their readers, so the label itself becomes the input --
 * whatever they type is exactly what the reader will see, in the position it will appear.
 * That is the whole reason this is a wrapper and not a list somewhere else on the page.
 *
 * Renders as a plain label for everyone who is not authoring, so the reader's form is
 * unchanged.
 */
@Component({
  selector: "texera-editable-label-wrapper",
  templateUrl: "./editable-label-wrapper.component.html",
  styleUrls: ["./editable-label-wrapper.component.scss"],
  imports: [NgIf, NzIconDirective],
})
export class EditableLabelWrapperComponent extends FieldWrapper {
  /**
   * Prepend this wrapper to a field, carrying its current naming and the callbacks.
   * `fallback` is the schema's own label, shown as the placeholder so an author can see
   * what leaving it blank would give them.
   */
  public static decorate(
    config: FormlyFieldConfig,
    state: { authoring: boolean; name: string; hidden: boolean; fallback: string; canHide?: boolean },
    rename: (name: string) => void,
    setHidden: (hidden: boolean) => void
  ): void {
    merge(config, {
      wrappers: [...(config.wrappers ?? []), "editable-label-wrapper"],
      props: {
        ...config.props,
        // The wrapper draws the label itself; leaving formly's own label on would print
        // it twice.
        label: "",
        authoring: state.authoring,
        authorName: state.name,
        authorHidden: state.hidden,
        canHide: state.canHide !== false,
        schemaLabel: state.fallback,
        renameField: rename,
        setFieldHidden: setHidden,
      },
    });
  }

  public onRename(event: Event): void {
    this.props["renameField"]((event.target as HTMLInputElement).value);
  }

  public onToggleHidden(): void {
    this.props["setFieldHidden"](!this.props["authorHidden"]);
  }
}
