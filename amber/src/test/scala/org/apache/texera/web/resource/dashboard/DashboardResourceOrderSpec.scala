/*
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

package org.apache.texera.web.resource.dashboard

import org.apache.texera.web.resource.dashboard.DashboardResource.{SearchQueryParams, getOrderFields}
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

/**
  * Verifies the sort keys produced by getOrderFields. A stable secondary key (creation time
  * descending) keeps the most recently created resource on top when the primary key ties -- which
  * happens because jOOQ stamps last_modified_time truncated to whole seconds, so resources created
  * in the same second would otherwise order arbitrarily.
  */
class DashboardResourceOrderSpec extends AnyFlatSpec with Matchers {

  private def params(orderBy: String): SearchQueryParams =
    SearchQueryParams(orderBy = orderBy)

  private val creationTimeDesc =
    UnifiedResourceSchema.resourceCreationTimeField.desc().toString

  "getOrderFields" should "append a creation-time-desc tiebreaker after the primary key" in {
    val fields = getOrderFields(params("EditTimeDesc"))
    fields should have size 2
    fields.head.toString shouldBe UnifiedResourceSchema.resourceLastModifiedTimeField.desc().toString
    fields(1).toString shouldBe creationTimeDesc
  }

  it should "add the tiebreaker for name sorts too, so equal names are deterministic" in {
    val fields = getOrderFields(params("NameAsc"))
    fields should have size 2
    fields.head.toString shouldBe UnifiedResourceSchema.resourceNameField.asc().toString
    fields(1).toString shouldBe creationTimeDesc
  }

  it should "not repeat creation time when it is already the primary key" in {
    val fields = getOrderFields(params("CreateTimeDesc"))
    fields should have size 1
    fields.head.toString shouldBe UnifiedResourceSchema.resourceCreationTimeField.desc().toString
  }

  it should "fall back to the creation-time tiebreaker for an unrecognized orderBy" in {
    val fields = getOrderFields(params("Bogus"))
    fields should have size 1
    fields.head.toString shouldBe creationTimeDesc
  }
}
