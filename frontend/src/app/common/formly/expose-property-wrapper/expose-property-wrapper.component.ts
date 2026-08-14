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
import { FieldWrapper, FormlyFieldConfig } from "@ngx-formly/core";
import { merge } from "lodash-es";

/**
 * Puts a tick box beside an operator property so an author can decide, right where the
 * property already lives, whether it should appear on the workflow's parameterized
 * form. The property editor is the place people already go to change a setting, so it
 * is also the natural place to say "let others change this one".
 *
 * The box only renders while an author is choosing; everyone else sees the property
 * editor exactly as it has always looked.
 */
@Component({
  selector: "texera-expose-property-wrapper",
  templateUrl: "./expose-property-wrapper.component.html",
  styleUrls: ["./expose-property-wrapper.component.scss"],
  imports: [NgIf],
})
export class ExposePropertyWrapperComponent extends FieldWrapper {
  /**
   * Prepend this wrapper to a field, carrying the state and the callback in `props`.
   * Keeps `form-field` outermost so the label and error rendering are untouched.
   */
  public static decorate(
    config: FormlyFieldConfig,
    choosing: boolean,
    exposed: boolean,
    toggle: (checked: boolean) => void
  ): void {
    merge(config, {
      wrappers: [...(config.wrappers ?? ["form-field"]), "expose-property-wrapper"],
      props: { ...config.props, choosing, exposed, toggleExposed: toggle },
    });
  }

  public onToggle(event: Event): void {
    this.props["toggleExposed"]((event.target as HTMLInputElement).checked);
  }
}
