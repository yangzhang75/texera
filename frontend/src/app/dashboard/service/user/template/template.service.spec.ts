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

import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";
import { AppSettings } from "../../../../common/app-setting";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { TemplateService, TEMPLATE_BASE_URL } from "./template.service";

describe("TemplateService (public/private)", () => {
  let service: TemplateService;
  let httpTestingController: HttpTestingController;
  const base = `${AppSettings.getApiEndpoint()}/${TEMPLATE_BASE_URL}`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        TemplateService,
        { provide: NotificationService, useValue: { success: () => {}, error: () => {}, info: () => {} } },
      ],
    });
    service = TestBed.inject(TemplateService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it("getTemplateType should GET /type/{tid} as text and return 'Public'/'Private'", () => {
    let received: string | undefined;
    service.getTemplateType(3).subscribe(t => (received = t));

    const req = httpTestingController.expectOne(`${base}/type/3`);
    expect(req.request.method).toEqual("GET");
    expect(req.request.responseType).toEqual("text");
    req.flush("Public");

    expect(received).toEqual("Public");
  });

  it("updateTemplateIsPublished(true) should PUT /public/{tid}", () => {
    service.updateTemplateIsPublished(3, true).subscribe();
    const req = httpTestingController.expectOne(`${base}/public/3`);
    expect(req.request.method).toEqual("PUT");
    req.flush(null);
  });

  it("updateTemplateIsPublished(false) should PUT /private/{tid}", () => {
    service.updateTemplateIsPublished(3, false).subscribe();
    const req = httpTestingController.expectOne(`${base}/private/3`);
    expect(req.request.method).toEqual("PUT");
    req.flush(null);
  });
});
