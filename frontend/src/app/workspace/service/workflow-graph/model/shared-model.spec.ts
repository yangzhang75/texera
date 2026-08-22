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

import { SharedModel } from "./shared-model";
import { CoeditorState, User } from "../../../../common/type/user";

/**
 * `isActive` means "my mouse is on a canvas", and it is what decides whether everyone
 * else has a pointer drawn for this person. Joining a room is not that, so these pin the
 * state a fresh member publishes.
 */
describe("SharedModel presence", () => {
  const user = { uid: 1, name: "tester", email: "t@example.com", role: "REGULAR" } as unknown as User;
  const localState = (m: SharedModel) => m.awareness.getLocalState() as unknown as CoeditorState;

  let model: SharedModel;

  afterEach(() => model?.destroy());

  // Publishing isActive:true on join claimed a pointer the user had never placed, parked
  // at the origin. The operator canvas hid it -- the first mouse move overwrote it --
  // but the parameterized canvas keeps the workflow collapsed, so those mouse events
  // never fire and the stray dot stayed on a coeditor's screen the whole time.
  it("joins without claiming a pointer on the canvas", () => {
    model = new SharedModel(undefined, user);

    expect(localState(model).isActive).toBe(false);
  });

  it("still announces who joined, so they appear as a coeditor", () => {
    model = new SharedModel(undefined, user);

    expect(localState(model).user.name).toBe("tester");
    expect(localState(model).user.clientId).toBeTruthy();
  });

  // The cursor starts at the origin, which is exactly why it must not be drawn until the
  // person has actually pointed somewhere.
  it("starts the cursor at the origin", () => {
    model = new SharedModel(undefined, user);

    expect(localState(model).userCursor).toEqual({ x: 0, y: 0 });
  });

  it("becomes active once the mouse enters a canvas", () => {
    model = new SharedModel(undefined, user);

    model.updateAwareness("isActive", true);

    expect(localState(model).isActive).toBe(true);
  });

  it("publishes nothing for a viewer who is not signed in", () => {
    model = new SharedModel(undefined, undefined);

    expect(model.awareness.getLocalState()).toEqual({});
  });
});
