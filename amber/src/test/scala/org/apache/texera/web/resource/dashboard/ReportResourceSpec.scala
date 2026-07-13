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

import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.MockTexeraDB
import org.apache.texera.dao.jooq.generated.Tables._
import org.apache.texera.dao.jooq.generated.enums.{PrivilegeEnum, ReportStatusEnum}
import org.apache.texera.dao.jooq.generated.tables.daos.{
  UserDao,
  WorkflowDao,
  WorkflowOfUserDao,
  WorkflowReportDao,
  WorkflowUserAccessDao
}
import org.apache.texera.dao.jooq.generated.tables.pojos.{
  User,
  Workflow,
  WorkflowOfUser,
  WorkflowUserAccess
}
import org.apache.texera.web.resource.dashboard.ReportResource.{PublishingRequest, ReportRequest}
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowResource
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers
import org.scalatest.{BeforeAndAfterAll, BeforeAndAfterEach}

import java.sql.Timestamp
import javax.ws.rs.{BadRequestException, ForbiddenException, NotFoundException}
import scala.jdk.CollectionConverters._

class ReportResourceSpec
    extends AnyFlatSpec
    with Matchers
    with BeforeAndAfterAll
    with BeforeAndAfterEach
    with MockTexeraDB {

  private val ownerUid = 1000 + scala.util.Random.nextInt(1000)
  private val reporterUid = 2000 + scala.util.Random.nextInt(1000)
  private val adminUid = 3000 + scala.util.Random.nextInt(1000)
  private val reporter2Uid = 4000 + scala.util.Random.nextInt(1000)
  private val publicWid = 5000 + scala.util.Random.nextInt(1000)
  private val privateWid = 6000 + scala.util.Random.nextInt(1000)

  private var owner: User = _
  private var reporter: User = _
  private var reporter2: User = _
  private var admin: User = _

  private var userDao: UserDao = _
  private var workflowDao: WorkflowDao = _
  private var workflowOfUserDao: WorkflowOfUserDao = _
  private var reportDao: WorkflowReportDao = _
  private var resource: ReportResource = _

  override protected def beforeAll(): Unit = {
    initializeDBAndReplaceDSLContext()
  }

  override protected def afterAll(): Unit = shutdownDB()

  override protected def beforeEach(): Unit = {
    userDao = new UserDao(getDSLContext.configuration())
    workflowDao = new WorkflowDao(getDSLContext.configuration())
    workflowOfUserDao = new WorkflowOfUserDao(getDSLContext.configuration())
    reportDao = new WorkflowReportDao(getDSLContext.configuration())
    resource = new ReportResource()

    cleanupTestData()

    owner = makeUser(ownerUid, "report_owner")
    reporter = makeUser(reporterUid, "report_reporter")
    reporter2 = makeUser(reporter2Uid, "report_reporter2")
    admin = makeUser(adminUid, "report_admin")
    userDao.insert(owner)
    userDao.insert(reporter)
    userDao.insert(reporter2)
    userDao.insert(admin)

    insertWorkflow(publicWid, "public_wf", isPublic = true)
    insertWorkflow(privateWid, "private_wf", isPublic = false)
    insertOwnership(ownerUid, publicWid)
    insertOwnership(ownerUid, privateWid)
  }

  override protected def afterEach(): Unit = cleanupTestData()

  private def makeUser(uid: Int, name: String): User = {
    val user = new User
    user.setUid(uid)
    user.setName(name)
    user.setEmail(s"$name@test.com")
    user.setPassword("password")
    user
  }

  private def insertWorkflow(wid: Int, name: String, isPublic: Boolean): Unit = {
    val workflow = new Workflow
    workflow.setWid(wid)
    workflow.setName(name)
    workflow.setContent("{}")
    workflow.setDescription("desc")
    workflow.setIsPublic(isPublic)
    workflow.setCreationTime(new Timestamp(System.currentTimeMillis()))
    workflow.setLastModifiedTime(new Timestamp(System.currentTimeMillis()))
    workflowDao.insert(workflow)
  }

  private def insertOwnership(uid: Int, wid: Int): Unit = {
    val ownership = new WorkflowOfUser
    ownership.setUid(uid)
    ownership.setWid(wid)
    workflowOfUserDao.insert(ownership)
  }

  private def session(user: User): SessionUser = new SessionUser(user)

  private def pendingCount(wid: Int): Int =
    reportDao.fetchByWid(wid).asScala.count(_.getStatus == ReportStatusEnum.PENDING)

  private def cleanupTestData(): Unit = {
    getDSLContext
      .deleteFrom(WORKFLOW_REPORT)
      .where(WORKFLOW_REPORT.WID.in(publicWid, privateWid))
      .execute()
    getDSLContext
      .deleteFrom(WORKFLOW_OF_USER)
      .where(WORKFLOW_OF_USER.WID.in(publicWid, privateWid))
      .execute()
    getDSLContext
      .deleteFrom(WORKFLOW)
      .where(WORKFLOW.WID.in(publicWid, privateWid))
      .execute()
    getDSLContext
      .deleteFrom(USER)
      .where(USER.UID.in(ownerUid, reporterUid, reporter2Uid, adminUid))
      .execute()
  }

  "createReport" should "store a pending report for a public workflow" in {
    resource.createReport(
      publicWid,
      ReportRequest("Spam / advertising", "buy stuff"),
      session(reporter)
    )
    val reports = reportDao.fetchByWid(publicWid).asScala
    reports should have size 1
    reports.head.getReporterUid shouldBe reporterUid
    reports.head.getReason shouldBe "Spam / advertising"
    reports.head.getDetail shouldBe "buy stuff"
    reports.head.getStatus shouldBe ReportStatusEnum.PENDING
  }

  it should "trim a blank detail down to null" in {
    resource.createReport(publicWid, ReportRequest("Other", "   "), session(reporter))
    reportDao.fetchByWid(publicWid).asScala.head.getDetail shouldBe null
  }

  it should "throw BadRequestException for a blank reason" in {
    assertThrows[BadRequestException] {
      resource.createReport(publicWid, ReportRequest("   ", "d"), session(reporter))
    }
  }

  it should "throw BadRequestException for a null reason" in {
    assertThrows[BadRequestException] {
      resource.createReport(publicWid, ReportRequest(null, "d"), session(reporter))
    }
  }

  it should "throw BadRequestException for a reason longer than 64 chars" in {
    assertThrows[BadRequestException] {
      resource.createReport(publicWid, ReportRequest("a" * 65, "d"), session(reporter))
    }
  }

  it should "throw NotFoundException for a non-existent workflow" in {
    assertThrows[NotFoundException] {
      resource.createReport(999999, ReportRequest("Other", "d"), session(reporter))
    }
  }

  it should "throw BadRequestException when the workflow is not public" in {
    assertThrows[BadRequestException] {
      resource.createReport(privateWid, ReportRequest("Other", "d"), session(reporter))
    }
  }

  it should "throw BadRequestException when the reporter is the owner" in {
    assertThrows[BadRequestException] {
      resource.createReport(publicWid, ReportRequest("Other", "d"), session(owner))
    }
  }

  it should "throw BadRequestException on a duplicate pending report by the same user" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    assertThrows[BadRequestException] {
      resource.createReport(publicWid, ReportRequest("Other", "again"), session(reporter))
    }
  }

  "listPendingReports" should "return pending reports with workflow, reporter and owner names" in {
    resource.createReport(publicWid, ReportRequest("Harassment", "bad"), session(reporter))
    val entries = resource.listPendingReports()
    entries should have size 1
    val entry = entries.head
    entry.wid shouldBe publicWid
    entry.workflowName shouldBe "public_wf"
    entry.reporterName shouldBe "report_reporter"
    entry.ownerName shouldBe "report_owner"
    entry.reason shouldBe "Harassment"
    entry.isPublic shouldBe true
  }

  it should "not include reports that have been resolved" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    resource.dismissReports(publicWid, session(admin))
    resource.listPendingReports() shouldBe empty
  }

  it should "not include reports for a workflow that is no longer public" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    // The workflow becomes private by some other means (owner unpublish, etc.);
    // its pending report is now moot and must drop out of the moderation queue.
    val workflow = workflowDao.fetchOneByWid(publicWid)
    workflow.setIsPublic(false)
    workflowDao.update(workflow)
    resource.listPendingReports() shouldBe empty
  }

  "dismissReports" should "mark pending reports as CLOSED without changing publicity" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    resource.dismissReports(publicWid, session(admin))
    pendingCount(publicWid) shouldBe 0
    reportDao.fetchByWid(publicWid).asScala.head.getStatus shouldBe ReportStatusEnum.CLOSED
    workflowDao.fetchOneByWid(publicWid).getIsPublic shouldBe true
  }

  "unpublishWorkflow" should "flip the workflow to private and mark reports ACTIONED" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    resource.unpublishWorkflow(publicWid, session(admin))
    workflowDao.fetchOneByWid(publicWid).getIsPublic shouldBe false
    pendingCount(publicWid) shouldBe 0
    reportDao.fetchByWid(publicWid).asScala.head.getStatus shouldBe ReportStatusEnum.ACTIONED
  }

  it should "throw NotFoundException for a non-existent workflow" in {
    assertThrows[NotFoundException] {
      resource.unpublishWorkflow(999999, session(admin))
    }
  }

  "moderationNotice" should "report a workflow as unpublished to its owner after an admin unpublishes it" in {
    resource.createReport(publicWid, ReportRequest("Harassment", "bad"), session(reporter))
    resource.unpublishWorkflow(publicWid, session(admin))

    val notice = resource.moderationNotice(publicWid, session(owner))
    notice.unpublished shouldBe true
    notice.reasons shouldBe List("Harassment")
    notice.resolvedTime should not be null
  }

  it should "return every distinct reason the workflow was reported for" in {
    resource.createReport(publicWid, ReportRequest("Harassment", "a"), session(reporter))
    resource.createReport(publicWid, ReportRequest("Spam / advertising", "b"), session(reporter2))
    resource.unpublishWorkflow(publicWid, session(admin))

    val notice = resource.moderationNotice(publicWid, session(owner))
    notice.unpublished shouldBe true
    notice.reasons should contain theSameElementsAs List("Harassment", "Spam / advertising")
  }

  it should "not report a still-public workflow as unpublished" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    // No admin action taken; the report is still pending and the workflow public.
    resource.moderationNotice(publicWid, session(owner)).unpublished shouldBe false
  }

  it should "not expose a moderation notice to a non-owner" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    resource.unpublishWorkflow(publicWid, session(admin))
    resource.moderationNotice(publicWid, session(reporter)).unpublished shouldBe false
  }

  it should "clear the notice once the owner republishes the workflow" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    resource.unpublishWorkflow(publicWid, session(admin))
    resource.moderationNotice(publicWid, session(owner)).unpublished shouldBe true

    val workflow = workflowDao.fetchOneByWid(publicWid)
    workflow.setIsPublic(true)
    workflowDao.update(workflow)

    resource.moderationNotice(publicWid, session(owner)).unpublished shouldBe false
  }

  "republishing a workflow" should "clear moderation so a later voluntary unpublish shows no notice" in {
    // Owner needs write access to call makePublic.
    val workflowUserAccessDao = new WorkflowUserAccessDao(getDSLContext.configuration())
    workflowUserAccessDao.insert(new WorkflowUserAccess(ownerUid, publicWid, PrivilegeEnum.WRITE))
    val workflowResource = new WorkflowResource()

    resource.createReport(publicWid, ReportRequest("Harassment", "x"), session(reporter))
    resource.unpublishWorkflow(publicWid, session(admin))
    resource.moderationNotice(publicWid, session(owner)).unpublished shouldBe true

    // The owner republishes: this resolves the moderation take-down.
    workflowResource.makePublic(publicWid, session(owner))
    resource.moderationNotice(publicWid, session(owner)).unpublished shouldBe false
    reportDao
      .fetchByWid(publicWid)
      .asScala
      .foreach(_.getStatus should not be ReportStatusEnum.ACTIONED)

    // The owner later unpublishes on their own: still no moderation notice.
    val workflow = workflowDao.fetchOneByWid(publicWid)
    workflow.setIsPublic(false)
    workflowDao.update(workflow)
    resource.moderationNotice(publicWid, session(owner)).unpublished shouldBe false
  }

  "moderatedWorkflows" should "list the owner's unpublished-by-moderation workflows only" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    resource.unpublishWorkflow(publicWid, session(admin))

    resource.moderatedWorkflows(session(owner)) should contain(publicWid: Integer)
    // A different user does not see the owner's workflow.
    resource.moderatedWorkflows(session(reporter)) should not contain (publicWid: Integer)
  }

  it should "drop a workflow from the list once it is republished" in {
    resource.createReport(publicWid, ReportRequest("Other", "d"), session(reporter))
    resource.unpublishWorkflow(publicWid, session(admin))
    resource.moderatedWorkflows(session(owner)) should contain(publicWid: Integer)

    val workflow = workflowDao.fetchOneByWid(publicWid)
    workflow.setIsPublic(true)
    workflowDao.update(workflow)

    resource.moderatedWorkflows(session(owner)) should not contain (publicWid: Integer)
  }

  "setAuthorPublishing" should "suspend and restore a user's publishing right" in {
    resource.setAuthorPublishing(ownerUid, PublishingRequest(disabled = true))
    userDao.fetchOneByUid(ownerUid).getPublishDisabled shouldBe true
    resource.setAuthorPublishing(ownerUid, PublishingRequest(disabled = false))
    userDao.fetchOneByUid(ownerUid).getPublishDisabled shouldBe false
  }

  "makePublic" should "be blocked for a user whose publishing is suspended" in {
    val workflowUserAccessDao = new WorkflowUserAccessDao(getDSLContext.configuration())
    workflowUserAccessDao.insert(new WorkflowUserAccess(ownerUid, privateWid, PrivilegeEnum.WRITE))
    val workflowResource = new WorkflowResource()

    resource.setAuthorPublishing(ownerUid, PublishingRequest(disabled = true))
    assertThrows[ForbiddenException] {
      workflowResource.makePublic(privateWid, session(owner))
    }

    // Lifting the suspension lets them publish again.
    resource.setAuthorPublishing(ownerUid, PublishingRequest(disabled = false))
    workflowResource.makePublic(privateWid, session(owner))
    workflowDao.fetchOneByWid(privateWid).getIsPublic shouldBe true
  }

  "resolving a workflow with reports from multiple users" should "close every pending report at once" in {
    resource.createReport(publicWid, ReportRequest("Harassment", "a"), session(reporter))
    resource.createReport(publicWid, ReportRequest("Spam / advertising", "b"), session(reporter2))
    pendingCount(publicWid) shouldBe 2
    // The endpoint returns one entry per report; the admin UI collapses them by workflow.
    resource.listPendingReports() should have size 2

    resource.dismissReports(publicWid, session(admin))

    pendingCount(publicWid) shouldBe 0
    resource.listPendingReports() shouldBe empty
    reportDao.fetchByWid(publicWid).asScala.foreach(_.getStatus shouldBe ReportStatusEnum.CLOSED)
  }
}
