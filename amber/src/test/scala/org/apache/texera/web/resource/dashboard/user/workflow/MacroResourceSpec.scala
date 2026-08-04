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
  UpdateMacroBodyRequest
}
import org.jooq.JSONB
import org.scalatest.BeforeAndAfterAll
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

import javax.ws.rs.{ForbiddenException, NotFoundException}
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

  // Insert a kind=MACRO workflow owned by testUid with WRITE access, return its
  // wid. Only testUid gets an access row; otherUid never does, so a public
  // macro is readable by otherUid solely via the IS_PUBLIC gate.
  private def createTestMacro(content: String, isPublic: Boolean = false): Integer = {
    val macroWf = new Workflow
    macroWf.setName("macro_spec")
    macroWf.setDescription("d")
    macroWf.setContent(content)
    macroWf.setIsPublic(isPublic)
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

  it should "allow a NON-owner to generate from a PUBLIC macro (Hub catalogue)" in {
    val publicMacro = createTestMacro(macroBody("CSVFileScan"), isPublic = true)

    // otherUid has no access row, but the macro is public -> allowed.
    val newWid = resource.generateWorkflow(publicMacro, generateReq(), sessionUser(otherUid))

    workflowDao.fetchOneByWid(newWid).getKind shouldBe WorkflowKindEnum.WORKFLOW
    realWidsFor(publicMacro) should contain(newWid)
  }

  it should "still reject a NON-owner generating from a PRIVATE macro" in {
    val privateMacro = createTestMacro(macroBody("CSVFileScan")) // isPublic = false

    assertThrows[ForbiddenException] {
      resource.generateWorkflow(privateMacro, generateReq(), sessionUser(otherUid))
    }
    realWidsFor(privateMacro) shouldBe empty
  }

  "get" should "let a NON-owner read a PUBLIC macro (readonly), but reject a private one" in {
    val publicMacro = createTestMacro(macroBody("Filter"), isPublic = true)

    val detail = resource.get(publicMacro, sessionUser(otherUid))
    detail.isOwner shouldBe false
    detail.readonly shouldBe true // read-only: public grants read, never write

    val privateMacro = createTestMacro(macroBody("Filter"))
    assertThrows[ForbiddenException] {
      resource.get(privateMacro, sessionUser(otherUid))
    }
  }

  "getPublic" should "read a PUBLIC macro without auth (readonly, not owned)" in {
    val publicMacro = createTestMacro(macroBody("Filter"), isPublic = true)

    // No requester argument — guest-accessible, mirroring the public-workflow read.
    val detail = resource.getPublic(publicMacro)
    detail.wid shouldBe publicMacro
    detail.isOwner shouldBe false
    detail.readonly shouldBe true // public read never grants edit
  }

  it should "404 a private (non-public) macro so it is never exposed to guests" in {
    val privateMacro = createTestMacro(macroBody("Filter")) // not public
    assertThrows[NotFoundException] {
      resource.getPublic(privateMacro)
    }
  }

  "listPublic" should "return public macros regardless of the requester's access, and exclude private ones" in {
    val pub = createTestMacro(macroBody("CSVFileScan"), isPublic = true)
    val priv = createTestMacro(macroBody("Filter")) // not public

    // Guest-accessible: no requester argument (a logged-out Hub visitor must be
    // able to browse the catalogue).
    val wids = resource.listPublic().map(_.wid)

    wids should contain(pub)
    wids should not contain priv
  }

  it should "leave isOwner=false and ship ownerUid so the frontend can resolve ownership" in {
    val pub = createTestMacro(macroBody("CSVFileScan"), isPublic = true)

    val summary = resource.listPublic().find(_.wid == pub)

    summary should be(defined)
    // The catalogue cannot resolve a requester server-side, so ownership is
    // never asserted here; the owner's uid is shipped for the frontend to match.
    summary.get.isOwner shouldBe false
    summary.get.ownerUid shouldBe Some(testUid)
  }

  "list" should "surface the macro body's operator types (the backend half of the runnable gate)" in {
    val macroWid = createTestMacro(macroBody("CSVFileScan", "Filter", "PythonUDFV2"))

    val summary = resource.list(sessionUser(testUid)).find(_.wid == macroWid)

    summary should be(defined)
    summary.get.bodyOperatorTypes should contain allOf ("CSVFileScan", "Filter", "PythonUDFV2")
    summary.get.isOwner shouldBe true
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
