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

package org.apache.texera.web.resource.dashboard.user.templated_workflow

import com.fasterxml.jackson.databind.JsonNode
import org.apache.texera.amber.util.JSONUtils.objectMapper
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.MockTexeraDB
import org.apache.texera.dao.jooq.generated.Tables
import org.apache.texera.dao.jooq.generated.tables.daos.{UserDao, WorkflowDao}
import org.apache.texera.dao.jooq.generated.tables.pojos.{User, Workflow}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

import javax.ws.rs.BadRequestException
import java.util.UUID

class TemplatedWorkflowResourceSpec
    extends AnyFlatSpec
    with BeforeAndAfterAll
    with Matchers
    with MockTexeraDB {

  private val testUid = 5000 + scala.util.Random.nextInt(1000)
  private val testWid = 6000 + scala.util.Random.nextInt(1000)
  private val operatorId = "TextInput-operator-1"

  private var workflowDao: WorkflowDao = _
  // lazy so it is constructed inside a test (after beforeAll swaps in the mock DB context),
  // not at spec construction time.
  private lazy val resource = new TemplatedWorkflowResource()

  private def sessionUser: SessionUser = {
    val user = new User
    user.setUid(testUid)
    new SessionUser(user)
  }

  // One operator whose `fileName` is the only configurable property.
  private def workflowContent(fileName: String): String =
    s"""{"operators":[{"operatorID":"$operatorId","operatorType":"TextInput",""" +
      s""""configurableProperties":["fileName"],"operatorProperties":{"fileName":"$fileName"}}],""" +
      s""""operatorPositions":{},"links":[],"commentBoxes":[],"settings":{"dataTransferBatchSize":400}}"""

  private def textNode(value: String): JsonNode = objectMapper.readTree("\"" + value + "\"")

  private def updateRequest(
      properties: Map[String, Map[String, JsonNode]]
  ): TemplatedWorkflowConfigurablePropertiesUpdateRequest = {
    val request = new TemplatedWorkflowConfigurablePropertiesUpdateRequest
    request.operatorProperties = properties
    request
  }

  private def freshWorkflow(): Unit = {
    getDSLContext
      .deleteFrom(Tables.WORKFLOW_VERSION)
      .where(Tables.WORKFLOW_VERSION.WID.eq(testWid))
      .execute()
    getDSLContext.deleteFrom(Tables.WORKFLOW).where(Tables.WORKFLOW.WID.eq(testWid)).execute()
    val workflow = new Workflow
    workflow.setWid(testWid)
    workflow.setName("templated_workflow_spec")
    workflow.setDescription("d")
    workflow.setContent(workflowContent("old.csv"))
    workflowDao.insert(workflow)
  }

  override protected def beforeAll(): Unit = {
    initializeDBAndReplaceDSLContext()
    val userDao = new UserDao(getDSLContext.configuration())
    val user = new User
    user.setUid(testUid)
    user.setName("templated_workflow_spec_user")
    user.setEmail(s"user_${UUID.randomUUID()}@example.com")
    user.setPassword("password")
    userDao.insert(user)

    workflowDao = new WorkflowDao(getDSLContext.configuration())
  }

  override protected def afterAll(): Unit = shutdownDB()

  "updateTemplatedWorkflowConfigurableProperties" should "write a changed file parameter into the workflow content" in {
    freshWorkflow()

    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("fileName" -> textNode("new.csv")))),
      sessionUser
    )

    val content = workflowDao.fetchOneByWid(testWid).getContent
    content should include("new.csv")
    content should not include "old.csv"
  }

  it should "keep applying on re-submit (second update overrides the first)" in {
    freshWorkflow()

    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("fileName" -> textNode("first.csv")))),
      sessionUser
    )
    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("fileName" -> textNode("second.csv")))),
      sessionUser
    )

    val content = workflowDao.fetchOneByWid(testWid).getContent
    content should include("second.csv")
    content should not include "first.csv"
  }

  it should "reject a property that is not in the operator's configurableProperties whitelist" in {
    freshWorkflow()

    assertThrows[BadRequestException] {
      resource.updateTemplatedWorkflowConfigurableProperties(
        testWid,
        updateRequest(Map(operatorId -> Map("notConfigurable" -> textNode("x")))),
        sessionUser
      )
    }
  }
}
