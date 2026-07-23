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

package org.apache.texera.web.resource.dashboard.user.workflow

import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.MockTexeraDB
import org.apache.texera.dao.jooq.generated.Tables
import org.apache.texera.dao.jooq.generated.enums.{PrivilegeEnum, WorkflowKindEnum}
import org.apache.texera.dao.jooq.generated.tables.daos.{
  MacroMetadataDao,
  UserDao,
  WorkflowDao,
  WorkflowOfUserDao,
  WorkflowUserAccessDao
}
import org.apache.texera.dao.jooq.generated.tables.pojos.{
  MacroMetadata,
  User,
  Workflow,
  WorkflowOfUser,
  WorkflowUserAccess
}
import org.apache.texera.web.resource.dashboard.user.workflow.MacroResource.{
  GenerateWorkflowRequest,
  UpdateConfigurablePropertiesRequest,
  UpdateMacroBodyRequest
}
import org.jooq.JSONB
import org.scalatest.BeforeAndAfterAll
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

import javax.ws.rs.ForbiddenException
import java.util.UUID
import scala.jdk.CollectionConverters._

/**
  * DB-backed tests for the unified Macro "Generate workflow" flow (T3a) and the
  * macro list. Covers: generate persists a new kind=WORKFLOW + records the
  * macro->workflow relation in workflow_of_template; the 1-to-n relation is
  * queryable both directions; preview vs real marking; access control; and the
  * list endpoint surfacing body operator types (the backend half of the
  * frontend runnable gate).
  */
class MacroResourceSpec
    extends AnyFlatSpec
    with BeforeAndAfterAll
    with Matchers
    with MockTexeraDB {

  private val testUid = 7000 + scala.util.Random.nextInt(1000)
  // A second user with no access to the test macro (for the access-control test).
  private val otherUid = testUid + 1

  private var workflowDao: WorkflowDao = _
  private var workflowOfUserDao: WorkflowOfUserDao = _
  private var workflowUserAccessDao: WorkflowUserAccessDao = _
  private var macroMetadataDao: MacroMetadataDao = _
  // lazy so it is constructed after beforeAll swaps in the mock DB context.
  private lazy val resource = new MacroResource()

  private def sessionUser(uid: Integer): SessionUser = {
    val user = new User
    user.setUid(uid)
    new SessionUser(user)
  }

  // A minimal macro body with the given operator types (no markers needed for
  // these tests; generate stores whatever content it is given verbatim).
  private def macroBody(operatorTypes: String*): String = {
    val ops = operatorTypes.zipWithIndex
      .map { case (t, i) => s"""{"operatorID":"$t-op-$i","operatorType":"$t","operatorProperties":{}}""" }
      .mkString(",")
    s"""{"operators":[$ops],"links":[],"inputs":[],"outputs":[]}"""
  }

  // Insert a kind=MACRO workflow owned by testUid with WRITE access, return its wid.
  private def createTestMacro(content: String): Integer = {
    val macroWf = new Workflow
    macroWf.setName("macro_spec")
    macroWf.setDescription("d")
    macroWf.setContent(content)
    macroWf.setIsPublic(false)
    macroWf.setKind(WorkflowKindEnum.MACRO)
    workflowDao.insert(macroWf)
    val wid = macroWf.getWid
    workflowOfUserDao.insert(new WorkflowOfUser(testUid, wid))
    workflowUserAccessDao.insert(new WorkflowUserAccess(testUid, wid, PrivilegeEnum.WRITE))
    // Seed the macro_metadata row (empty port/param spec) -- get() and the
    // configurable-properties endpoint require it.
    macroMetadataDao.insert(new MacroMetadata(wid, JSONB.valueOf("{}"), JSONB.valueOf("{}"), null, null))
    wid
  }

  private def generateReq(
      name: String = "generated",
      content: String = macroBody("CSVFileScan"),
      description: Option[String] = None,
      preview: Boolean = false
  ): GenerateWorkflowRequest = GenerateWorkflowRequest(name, content, description, preview)

  // Workflows generated from a macro (tid = macro wid), split by preview marker.
  private def realWidsFor(macroWid: Integer): Seq[Integer] =
    getDSLContext
      .select(Tables.WORKFLOW_OF_TEMPLATE.WID)
      .from(Tables.WORKFLOW_OF_TEMPLATE)
      .where(
        Tables.WORKFLOW_OF_TEMPLATE.TID.eq(macroWid).and(Tables.WORKFLOW_OF_TEMPLATE.PARAMETERS.ne("preview"))
      )
      .fetch(Tables.WORKFLOW_OF_TEMPLATE.WID)
      .asScala
      .toSeq

  private def previewWidsFor(macroWid: Integer): Seq[Integer] =
    getDSLContext
      .select(Tables.WORKFLOW_OF_TEMPLATE.WID)
      .from(Tables.WORKFLOW_OF_TEMPLATE)
      .where(
        Tables.WORKFLOW_OF_TEMPLATE.TID.eq(macroWid).and(Tables.WORKFLOW_OF_TEMPLATE.PARAMETERS.eq("preview"))
      )
      .fetch(Tables.WORKFLOW_OF_TEMPLATE.WID)
      .asScala
      .toSeq

  // Reverse direction: which macro (tid) was this workflow generated from?
  private def macroOfWorkflow(wid: Integer): Option[Integer] =
    Option(
      getDSLContext
        .select(Tables.WORKFLOW_OF_TEMPLATE.TID)
        .from(Tables.WORKFLOW_OF_TEMPLATE)
        .where(Tables.WORKFLOW_OF_TEMPLATE.WID.eq(wid))
        .fetchOne(Tables.WORKFLOW_OF_TEMPLATE.TID)
    )

  override protected def beforeAll(): Unit = {
    initializeDBAndReplaceDSLContext()
    val userDao = new UserDao(getDSLContext.configuration())
    Seq((testUid, "macro_spec_user"), (otherUid, "macro_spec_other")).foreach {
      case (uid, name) =>
        val user = new User
        user.setUid(uid)
        user.setName(name)
        user.setEmail(s"user_${UUID.randomUUID()}@example.com")
        user.setPassword("password")
        userDao.insert(user)
    }
    workflowDao = new WorkflowDao(getDSLContext.configuration())
    workflowOfUserDao = new WorkflowOfUserDao(getDSLContext.configuration())
    workflowUserAccessDao = new WorkflowUserAccessDao(getDSLContext.configuration())
    macroMetadataDao = new MacroMetadataDao(getDSLContext.configuration())
  }

  override protected def afterAll(): Unit = shutdownDB()

  "generateWorkflow" should "persist a new independent kind=WORKFLOW and link it to the macro" in {
    val macroWid = createTestMacro(macroBody("CSVFileScan"))

    val newWid = resource.generateWorkflow(macroWid, generateReq(), sessionUser(testUid))

    val created = workflowDao.fetchOneByWid(newWid)
    created should not be null
    created.getKind shouldBe WorkflowKindEnum.WORKFLOW // a real workflow, not a macro
    created.getName shouldBe "generated"
    realWidsFor(macroWid) should contain(newWid)
  }

  it should "carry the optional description onto the generated workflow" in {
    val macroWid = createTestMacro(macroBody("CSVFileScan"))

    val newWid =
      resource.generateWorkflow(macroWid, generateReq(description = Some("my desc")), sessionUser(testUid))

    workflowDao.fetchOneByWid(newWid).getDescription shouldBe "my desc"
  }

  it should "create a distinct workflow on each call (1-to-n), all queryable both directions" in {
    val macroWid = createTestMacro(macroBody("CSVFileScan"))

    val w1 = resource.generateWorkflow(macroWid, generateReq(name = "w1"), sessionUser(testUid))
    val w2 = resource.generateWorkflow(macroWid, generateReq(name = "w2"), sessionUser(testUid))
    val w3 = resource.generateWorkflow(macroWid, generateReq(name = "w3"), sessionUser(testUid))

    // 1 -> n forward: the macro lists all three generated workflows.
    w1 should not be w2
    w2 should not be w3
    realWidsFor(macroWid) should contain allOf (w1, w2, w3)
    // n -> 1 reverse: each workflow points back to the same macro.
    macroOfWorkflow(w1) shouldBe Some(macroWid)
    macroOfWorkflow(w2) shouldBe Some(macroWid)
    macroOfWorkflow(w3) shouldBe Some(macroWid)
  }

  it should "mark a preview generation with the 'preview' marker (hidden from the Workflows list)" in {
    val macroWid = createTestMacro(macroBody("CSVFileScan"))

    val previewWid = resource.generateWorkflow(macroWid, generateReq(preview = true), sessionUser(testUid))

    previewWidsFor(macroWid) should contain(previewWid)
    realWidsFor(macroWid) should not contain previewWid
  }

  it should "reject a user without read access to the macro (access control still enforced)" in {
    val macroWid = createTestMacro(macroBody("CSVFileScan"))

    assertThrows[ForbiddenException] {
      resource.generateWorkflow(macroWid, generateReq(), sessionUser(otherUid))
    }
    // No workflow was generated for the rejected caller.
    realWidsFor(macroWid) shouldBe empty
  }

  "list" should "surface the macro body's operator types (the backend half of the runnable gate)" in {
    val macroWid = createTestMacro(macroBody("CSVFileScan", "Filter", "PythonUDFV2"))

    val summary = resource.list(sessionUser(testUid)).find(_.wid == macroWid)

    summary should be(defined)
    summary.get.bodyOperatorTypes should contain allOf ("CSVFileScan", "Filter", "PythonUDFV2")
    summary.get.isOwner shouldBe true
  }

  "updateConfigurableProperties" should "persist the Template-mode whitelist into param_spec (read back via get)" in {
    val macroWid = createTestMacro(macroBody("Filter", "CSVFileScan"))

    resource.updateConfigurableProperties(
      macroWid,
      UpdateConfigurablePropertiesRequest(Map("Filter-op-0" -> List("condition", "keepValue"))),
      sessionUser(testUid)
    )

    val paramSpec = resource.get(macroWid, sessionUser(testUid)).paramSpec
    val stored = paramSpec.get("Filter-op-0")
    stored should not be null
    stored.asScala.map(_.asText).toList should contain allOf ("condition", "keepValue")
  }

  it should "leave the macro body content untouched (whitelist lives only in param_spec)" in {
    val body = macroBody("Filter", "CSVFileScan")
    val macroWid = createTestMacro(body)

    resource.updateConfigurableProperties(
      macroWid,
      UpdateConfigurablePropertiesRequest(Map("Filter-op-0" -> List("condition"))),
      sessionUser(testUid)
    )

    // The stored macro content is byte-for-byte what we created it with.
    workflowDao.fetchOneByWid(macroWid).getContent shouldBe body
  }

  it should "reject a caller without write access to the macro" in {
    val macroWid = createTestMacro(macroBody("Filter", "CSVFileScan"))

    assertThrows[ForbiddenException] {
      resource.updateConfigurableProperties(
        macroWid,
        UpdateConfigurablePropertiesRequest(Map("Filter-op-0" -> List("condition"))),
        sessionUser(otherUid)
      )
    }
  }

  "updateMacroBody" should "overwrite the body content and refresh port_spec from the markers" in {
    val macroWid = createTestMacro(macroBody("Filter"))
    val newBody =
      """{"operators":[
        |{"operatorID":"MacroInput-op-0","operatorType":"MacroInput","portIndex":0},
        |{"operatorID":"Filter-op-1","operatorType":"Filter","operatorProperties":{}},
        |{"operatorID":"MacroOutput-op-2","operatorType":"MacroOutput","portIndex":0}
        |],"links":[],"inputs":[{"index":0}],"outputs":[{"index":0}]}""".stripMargin

    resource.updateMacroBody(macroWid, UpdateMacroBodyRequest(newBody), sessionUser(testUid))

    workflowDao.fetchOneByWid(macroWid).getContent shouldBe newBody
    val detail = resource.get(macroWid, sessionUser(testUid))
    detail.portSpec.inputs.map(_.index) shouldBe List(0)
    detail.portSpec.outputs.map(_.index) shouldBe List(0)
  }

  it should "reject updateMacroBody from a caller without write access" in {
    val macroWid = createTestMacro(macroBody("Filter"))

    assertThrows[ForbiddenException] {
      resource.updateMacroBody(macroWid, UpdateMacroBodyRequest(macroBody("Filter")), sessionUser(otherUid))
    }
  }
}
