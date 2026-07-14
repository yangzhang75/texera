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
import org.apache.texera.dao.jooq.generated.tables.daos.{TemplateDao, UserDao, WorkflowDao}
import org.apache.texera.dao.jooq.generated.tables.pojos.{Template, User, Workflow}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

import javax.ws.rs.{BadRequestException, NotFoundException}
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
  private var templateDao: TemplateDao = _
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

  // One operator with two configurable properties and initial values.
  private def multiPropContent(limit: Int, offset: Int): String =
    s"""{"operators":[{"operatorID":"$operatorId","operatorType":"Limit",""" +
      s""""configurableProperties":["limit","offset"],"operatorProperties":{"limit":$limit,"offset":$offset}}],""" +
      s""""operatorPositions":{},"links":[],"commentBoxes":[],"settings":{"dataTransferBatchSize":400}}"""

  // One operator that declares a configurable property but has no operatorProperties object yet.
  private def noPropertiesContent(): String =
    s"""{"operators":[{"operatorID":"$operatorId","operatorType":"Limit",""" +
      s""""configurableProperties":["limit"]}],""" +
      s""""operatorPositions":{},"links":[],"commentBoxes":[],"settings":{"dataTransferBatchSize":400}}"""

  // One operator with an empty configurableProperties whitelist (nothing may be written).
  private def noConfigurablePropertiesContent(): String =
    s"""{"operators":[{"operatorID":"$operatorId","operatorType":"Limit",""" +
      s""""configurableProperties":[],"operatorProperties":{"limit":2}}],""" +
      s""""operatorPositions":{},"links":[],"commentBoxes":[],"settings":{"dataTransferBatchSize":400}}"""

  private def textNode(value: String): JsonNode = objectMapper.readTree("\"" + value + "\"")

  private def numberNode(value: Int): JsonNode = objectMapper.readTree(value.toString)

  private def updateRequest(
      properties: Map[String, Map[String, JsonNode]],
      name: String = null
  ): TemplatedWorkflowConfigurablePropertiesUpdateRequest = {
    val request = new TemplatedWorkflowConfigurablePropertiesUpdateRequest
    request.operatorProperties = properties
    request.name = name
    request
  }

  private def freshWorkflowWith(content: String): Unit = {
    getDSLContext
      .deleteFrom(Tables.WORKFLOW_VERSION)
      .where(Tables.WORKFLOW_VERSION.WID.eq(testWid))
      .execute()
    getDSLContext.deleteFrom(Tables.WORKFLOW).where(Tables.WORKFLOW.WID.eq(testWid)).execute()
    val workflow = new Workflow
    workflow.setWid(testWid)
    workflow.setName("templated_workflow_spec")
    workflow.setDescription("d")
    workflow.setContent(content)
    workflowDao.insert(workflow)
  }

  private def freshWorkflow(): Unit = freshWorkflowWith(workflowContent("old.csv"))

  private def versionCount(): Int =
    getDSLContext.fetchCount(Tables.WORKFLOW_VERSION, Tables.WORKFLOW_VERSION.WID.eq(testWid))

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
    templateDao = new TemplateDao(getDSLContext.configuration())
  }

  /** Insert a template row and return its generated tid. */
  private def createTemplate(content: String): Integer = {
    val template = new Template
    template.setName("templated_workflow_spec_template")
    template.setDescription("d")
    template.setContent(content)
    template.setIsPublic(false)
    templateDao.insert(template)
    template.getTid
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

  it should "leave untouched (but still whitelisted) properties unchanged when only one is submitted" in {
    freshWorkflowWith(multiPropContent(limit = 2, offset = 5))

    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("limit" -> numberNode(88)))),
      sessionUser
    )

    val content = objectMapper.readTree(workflowDao.fetchOneByWid(testWid).getContent)
    val props = content.get("operators").get(0).get("operatorProperties")
    props.get("limit").asInt() shouldBe 88
    props.get("offset").asInt() shouldBe 5
  }

  it should "write multiple whitelisted properties in a single request" in {
    freshWorkflowWith(multiPropContent(limit = 2, offset = 5))

    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("limit" -> numberNode(10), "offset" -> numberNode(20)))),
      sessionUser
    )

    val props =
      objectMapper.readTree(workflowDao.fetchOneByWid(testWid).getContent).get("operators").get(0).get("operatorProperties")
    props.get("limit").asInt() shouldBe 10
    props.get("offset").asInt() shouldBe 20
  }

  it should "preserve the JSON type of a submitted value (a number stays a number, not a string)" in {
    freshWorkflowWith(multiPropContent(limit = 2, offset = 5))

    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("limit" -> numberNode(88)))),
      sessionUser
    )

    val limitNode =
      objectMapper.readTree(workflowDao.fetchOneByWid(testWid).getContent).get("operators").get(0).get("operatorProperties").get("limit")
    limitNode.isNumber shouldBe true
    limitNode.asInt() shouldBe 88
  }

  it should "create the operatorProperties object when the operator has none yet" in {
    freshWorkflowWith(noPropertiesContent())

    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("limit" -> numberNode(7)))),
      sessionUser
    )

    val props =
      objectMapper.readTree(workflowDao.fetchOneByWid(testWid).getContent).get("operators").get(0).get("operatorProperties")
    props.get("limit").asInt() shouldBe 7
  }

  it should "record a new workflow version on each successful update" in {
    freshWorkflow()
    val before = versionCount()

    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("fileName" -> textNode("v2.csv")))),
      sessionUser
    )

    versionCount() should be > before
  }

  it should "reject an empty request (no operator properties provided)" in {
    freshWorkflow()

    assertThrows[BadRequestException] {
      resource.updateTemplatedWorkflowConfigurableProperties(
        testWid,
        updateRequest(Map.empty),
        sessionUser
      )
    }
  }

  it should "reject an operatorID that does not exist in the workflow" in {
    freshWorkflow()

    assertThrows[BadRequestException] {
      resource.updateTemplatedWorkflowConfigurableProperties(
        testWid,
        updateRequest(Map("does-not-exist" -> Map("fileName" -> textNode("x.csv")))),
        sessionUser
      )
    }
  }

  it should "reject writing to an operator whose configurableProperties whitelist is empty" in {
    freshWorkflowWith(noConfigurablePropertiesContent())

    assertThrows[BadRequestException] {
      resource.updateTemplatedWorkflowConfigurableProperties(
        testWid,
        updateRequest(Map(operatorId -> Map("limit" -> numberNode(9)))),
        sessionUser
      )
    }
  }

  it should "reject an update to a workflow that does not exist" in {
    freshWorkflow()

    assertThrows[NotFoundException] {
      resource.updateTemplatedWorkflowConfigurableProperties(
        999999,
        updateRequest(Map(operatorId -> Map("fileName" -> textNode("x.csv")))),
        sessionUser
      )
    }
  }

  "buildTemplatedWorkflowIfNotExists" should "be idempotent (return the same wid on repeated calls)" in {
    val tid = createTemplate(workflowContent("preview.csv"))
    val wid1 = resource.buildTemplatedWorkflowIfNotExists(tid, sessionUser)
    val wid2 = resource.buildTemplatedWorkflowIfNotExists(tid, sessionUser)
    wid2 shouldBe wid1
  }

  "instantiateTemplatedWorkflow" should "create a NEW workflow on each call (1-to-n)" in {
    val tid = createTemplate(workflowContent("preview.csv"))
    val widA = resource.instantiateTemplatedWorkflow(tid, updateRequest(Map.empty), sessionUser)
    val widB = resource.instantiateTemplatedWorkflow(tid, updateRequest(Map.empty), sessionUser)
    widA should not be widB
  }

  it should "record every instantiated workflow in workflow_of_template (so it can be tagged)" in {
    val tid = createTemplate(workflowContent("preview.csv"))
    val widA = resource.instantiateTemplatedWorkflow(tid, updateRequest(Map.empty), sessionUser)
    val widB = resource.instantiateTemplatedWorkflow(tid, updateRequest(Map.empty), sessionUser)
    val listed = resource.listTemplatedWorkflows(sessionUser).map(_.wid)
    listed should contain(widA)
    listed should contain(widB)
  }

  it should "apply the submitted configurable properties to the new workflow" in {
    val tid = createTemplate(workflowContent("old.csv"))
    val wid = resource.instantiateTemplatedWorkflow(
      tid,
      updateRequest(Map(operatorId -> Map("fileName" -> textNode("new.csv")))),
      sessionUser
    )
    workflowDao.fetchOneByWid(wid).getContent should include("new.csv")
  }

  it should "leave the instantiated workflow's timestamps un-truncated (so the newest sorts to the top)" in {
    // Applying properties must not re-stamp the workflow's timestamps truncated to whole seconds;
    // otherwise workflows created in the same second sort arbitrarily and the newest can drop below
    // an older one. createWorkflow inserts both timestamps from the same DB default, so they are
    // equal; a whole-second re-stamp on update would push last_modified past creation. Asserting
    // they remain equal proves the applied update did not re-stamp/truncate.
    val tid = createTemplate(workflowContent("old.csv"))
    val wid = resource.instantiateTemplatedWorkflow(
      tid,
      updateRequest(Map(operatorId -> Map("fileName" -> textNode("new.csv")))),
      sessionUser
    )
    val workflow = workflowDao.fetchOneByWid(wid)
    workflow.getLastModifiedTime shouldBe workflow.getCreationTime
  }

  it should "name the new workflow after the user's chosen name when one is provided" in {
    val tid = createTemplate(workflowContent("old.csv"))
    val wid = resource.instantiateTemplatedWorkflow(
      tid,
      updateRequest(Map(operatorId -> Map("fileName" -> textNode("new.csv"))), name = "My Report"),
      sessionUser
    )
    workflowDao.fetchOneByWid(wid).getName shouldBe "My Report"
  }

  it should "fall back to the template's name when no name is provided (or blank)" in {
    val tid = createTemplate(workflowContent("old.csv"))
    val templateName = new TemplateDao(getDSLContext.configuration()).fetchOneByTid(tid).getName
    val widNull = resource.instantiateTemplatedWorkflow(tid, updateRequest(Map.empty), sessionUser)
    val widBlank =
      resource.instantiateTemplatedWorkflow(tid, updateRequest(Map.empty, name = "   "), sessionUser)
    workflowDao.fetchOneByWid(widNull).getName shouldBe templateName
    workflowDao.fetchOneByWid(widBlank).getName shouldBe templateName
  }

  it should "not bump the workflow's timestamps when applying properties (targeted content update)" in {
    freshWorkflow()
    val before = workflowDao.fetchOneByWid(testWid)
    resource.updateTemplatedWorkflowConfigurableProperties(
      testWid,
      updateRequest(Map(operatorId -> Map("fileName" -> textNode("kept.csv")))),
      sessionUser
    )
    val after = workflowDao.fetchOneByWid(testWid)
    // Content changed, timestamps preserved exactly (no whole-second truncation).
    after.getContent should include("kept.csv")
    after.getCreationTime shouldBe before.getCreationTime
    after.getLastModifiedTime shouldBe before.getLastModifiedTime
  }
}
