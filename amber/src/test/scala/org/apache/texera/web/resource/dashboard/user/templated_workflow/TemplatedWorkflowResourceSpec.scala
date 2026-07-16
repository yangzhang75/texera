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
import org.apache.texera.dao.jooq.generated.enums.PrivilegeEnum
import org.apache.texera.dao.jooq.generated.tables.daos.{
  TemplateDao,
  TemplateOfUserDao,
  TemplateUserAccessDao,
  UserDao,
  WorkflowDao,
  WorkflowUserAccessDao
}
import org.apache.texera.dao.jooq.generated.tables.pojos.{
  Template,
  TemplateOfUser,
  TemplateUserAccess,
  User,
  Workflow,
  WorkflowUserAccess
}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

import javax.ws.rs.{BadRequestException, ForbiddenException, NotFoundException}
import java.util.UUID
import scala.jdk.CollectionConverters._

class TemplatedWorkflowResourceSpec
    extends AnyFlatSpec
    with BeforeAndAfterAll
    with Matchers
    with MockTexeraDB {

  private val testUid = 5000 + scala.util.Random.nextInt(1000)
  // A second, unrelated user with no access to the test template/workflow (for access-control tests).
  private val otherUid = testUid + 1
  private val testWid = 6000 + scala.util.Random.nextInt(1000)
  private val operatorId = "TextInput-operator-1"

  private var workflowDao: WorkflowDao = _
  private var templateDao: TemplateDao = _
  private var templateOfUserDao: TemplateOfUserDao = _
  private var templateUserAccessDao: TemplateUserAccessDao = _
  private var workflowUserAccessDao: WorkflowUserAccessDao = _
  // lazy so it is constructed inside a test (after beforeAll swaps in the mock DB context),
  // not at spec construction time.
  private lazy val resource = new TemplatedWorkflowResource()

  private def sessionUser: SessionUser = {
    val user = new User
    user.setUid(testUid)
    new SessionUser(user)
  }

  private def otherSessionUser: SessionUser = {
    val user = new User
    user.setUid(otherUid)
    new SessionUser(user)
  }

  // Insert a template owned by testUid (with a READ access row, matching how /template/create seeds
  // ownership) and return its generated tid.
  private def createTestTemplate(content: String): Integer = {
    val template = new Template(null, "spec_template", "d", content, null, null, "")
    templateDao.insert(template)
    val tid = template.getTid
    templateOfUserDao.insert(new TemplateOfUser(testUid, tid))
    templateUserAccessDao.insert(new TemplateUserAccess(testUid, tid, PrivilegeEnum.READ))
    tid
  }

  private def previewWidsFor(tid: Integer): Seq[Integer] =
    getDSLContext
      .select(Tables.WORKFLOW_OF_TEMPLATE.WID)
      .from(Tables.WORKFLOW_OF_TEMPLATE)
      .where(
        Tables.WORKFLOW_OF_TEMPLATE.TID
          .eq(tid)
          .and(Tables.WORKFLOW_OF_TEMPLATE.PARAMETERS.eq("preview"))
      )
      .fetch(Tables.WORKFLOW_OF_TEMPLATE.WID)
      .asScala
      .toSeq

  private def realWidsFor(tid: Integer): Seq[Integer] =
    getDSLContext
      .select(Tables.WORKFLOW_OF_TEMPLATE.WID)
      .from(Tables.WORKFLOW_OF_TEMPLATE)
      .where(
        Tables.WORKFLOW_OF_TEMPLATE.TID
          .eq(tid)
          .and(Tables.WORKFLOW_OF_TEMPLATE.PARAMETERS.ne("preview"))
      )
      .fetch(Tables.WORKFLOW_OF_TEMPLATE.WID)
      .asScala
      .toSeq

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
      properties: Map[String, Map[String, JsonNode]]
  ): TemplatedWorkflowConfigurablePropertiesUpdateRequest = {
    val request = new TemplatedWorkflowConfigurablePropertiesUpdateRequest
    request.operatorProperties = properties
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
    // /update requires the caller to have WRITE access to the workflow; grant it (deleting the
    // WORKFLOW row above cascades the old access row away).
    workflowUserAccessDao.insert(new WorkflowUserAccess(testUid, testWid, PrivilegeEnum.WRITE))
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
    templateOfUserDao = new TemplateOfUserDao(getDSLContext.configuration())
    templateUserAccessDao = new TemplateUserAccessDao(getDSLContext.configuration())
    workflowUserAccessDao = new WorkflowUserAccessDao(getDSLContext.configuration())
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

  it should "reject an update from a user without write access to the workflow (IDOR guard)" in {
    freshWorkflow() // owned by testUid with WRITE

    assertThrows[ForbiddenException] {
      resource.updateTemplatedWorkflowConfigurableProperties(
        testWid,
        updateRequest(Map(operatorId -> Map("fileName" -> textNode("evil.csv")))),
        otherSessionUser
      )
    }
    // The content must be untouched by the rejected write.
    workflowDao.fetchOneByWid(testWid).getContent should not include "evil.csv"
  }

  "buildTemplatedWorkflowIfNotExists" should "create a hidden preview workflow and be idempotent" in {
    val tid = createTestTemplate(workflowContent("preview.csv"))

    val wid1 = resource.buildTemplatedWorkflowIfNotExists(tid, sessionUser)
    val wid2 = resource.buildTemplatedWorkflowIfNotExists(tid, sessionUser)

    // Opening the build page twice must reuse the same preview, never spawn a second workflow.
    wid1 shouldBe wid2
    previewWidsFor(tid) shouldBe Seq(wid1)
    realWidsFor(tid) shouldBe empty
  }

  it should "reject a user without read access to the template" in {
    val tid = createTestTemplate(workflowContent("x.csv"))

    assertThrows[ForbiddenException] {
      resource.buildTemplatedWorkflowIfNotExists(tid, otherSessionUser)
    }
  }

  "instantiateTemplatedWorkflow" should "create a new workflow on each call (1-to-n) and apply whitelisted properties" in {
    val tid = createTestTemplate(workflowContent("orig.csv"))
    val request = updateRequest(Map(operatorId -> Map("fileName" -> textNode("mine.csv"))))

    val w1 = resource.instantiateTemplatedWorkflow(tid, request, sessionUser)
    val w2 = resource.instantiateTemplatedWorkflow(tid, request, sessionUser)

    // Every Submit yields a distinct, non-preview (real) workflow linked to the template.
    w1 should not be w2
    realWidsFor(tid) should contain allOf (w1, w2)
    previewWidsFor(tid) shouldBe empty

    // The submitted value was applied to the new workflow's content.
    val content = workflowDao.fetchOneByWid(w1).getContent
    content should include("mine.csv")
    content should not include "orig.csv"
  }

  it should "reject a user without read access to the template" in {
    val tid = createTestTemplate(workflowContent("x.csv"))

    assertThrows[ForbiddenException] {
      resource.instantiateTemplatedWorkflow(
        tid,
        updateRequest(Map(operatorId -> Map("fileName" -> textNode("mine.csv")))),
        otherSessionUser
      )
    }
  }
}
