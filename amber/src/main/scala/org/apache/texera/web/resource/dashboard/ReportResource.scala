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

import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.Tables._
import org.apache.texera.dao.jooq.generated.enums.ReportStatusEnum
import org.apache.texera.dao.jooq.generated.tables.daos.{
  WorkflowDao,
  WorkflowOfUserDao,
  WorkflowReportDao
}
import org.apache.texera.dao.jooq.generated.tables.pojos.{Workflow, WorkflowReport}
import org.apache.texera.web.resource.dashboard.ReportResource.{
  MAX_REASON_LENGTH,
  ModerationNotice,
  PublishingRequest,
  ReportEntry,
  ReportRequest,
  ReportRow,
  context
}
import org.jooq.DSLContext

import java.sql.Timestamp
import javax.annotation.security.RolesAllowed
import javax.ws.rs._
import javax.ws.rs.core.MediaType
import scala.jdk.CollectionConverters._

object ReportResource {
  private def context: DSLContext =
    SqlServer
      .getInstance()
      .createDSLContext()

  /** Reason is stored in a VARCHAR(64) column; keep it bounded. */
  private val MAX_REASON_LENGTH: Int = 64

  /** JSON body submitted by a user filing a report. */
  case class ReportRequest(reason: String, detail: String)

  /** JSON body for suspending / restoring a user's right to publish workflows. */
  case class PublishingRequest(disabled: Boolean)

  /**
    * Whether a workflow was taken down by moderation, shown to its owner.
    * `unpublished` is true only while the workflow is still private and has an
    * actioned report; re-publishing it clears the notice. `reasons` lists every
    * distinct reason the workflow was reported for.
    */
  case class ModerationNotice(unpublished: Boolean, reasons: List[String], resolvedTime: Timestamp)

  /** A pending report as shown in the admin moderation view. */
  case class ReportEntry(
      reportId: Integer,
      wid: Integer,
      workflowName: String,
      isPublic: Boolean,
      reporterName: String,
      ownerUid: Integer,
      ownerName: String,
      ownerPublishDisabled: Boolean,
      reason: String,
      detail: String,
      status: ReportStatusEnum,
      creationTime: Timestamp
  )

  /** Intermediate row fetched from the DB before owner/reporter names are resolved. */
  private case class ReportRow(
      reportId: Integer,
      wid: Integer,
      workflowName: String,
      isPublic: Boolean,
      reporterUid: Integer,
      ownerUid: Integer,
      reason: String,
      detail: String,
      status: ReportStatusEnum,
      creationTime: Timestamp
  )
}

/**
  * Content-moderation reports against public workflows.
  *
  * Any logged-in user can report a public workflow; admins review the pending
  * reports and either dismiss them or unpublish the workflow. "Unpublish" simply
  * flips the workflow back to private (removing it from the public Hub) while the
  * owner keeps their private copy.
  */
@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/report")
class ReportResource {

  final private val reportDao = new WorkflowReportDao(context.configuration)
  final private val workflowDao = new WorkflowDao(context.configuration)
  final private val workflowOfUserDao = new WorkflowOfUserDao(context.configuration)

  private def isOwner(wid: Integer, uid: Integer): Boolean = {
    workflowOfUserDao.existsById(
      context
        .newRecord(WORKFLOW_OF_USER.UID, WORKFLOW_OF_USER.WID)
        .values(uid, wid)
    )
  }

  /**
    * File a report against a public workflow.
    */
  @POST
  @Consumes(Array(MediaType.APPLICATION_JSON))
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}")
  def createReport(
      @PathParam("wid") wid: Integer,
      request: ReportRequest,
      @Auth user: SessionUser
  ): Unit = {
    val uid = user.getUid

    val reason = Option(request).flatMap(r => Option(r.reason)).map(_.trim).getOrElse("")
    if (reason.isEmpty) {
      throw new BadRequestException("A report reason is required.")
    }
    if (reason.length > MAX_REASON_LENGTH) {
      throw new BadRequestException(s"Report reason must be at most $MAX_REASON_LENGTH characters.")
    }

    val workflow: Workflow = workflowDao.fetchOneByWid(wid)
    if (workflow == null) {
      throw new NotFoundException(s"Workflow with id $wid not found")
    }
    if (!workflow.getIsPublic) {
      throw new BadRequestException("Only public workflows can be reported.")
    }
    if (isOwner(wid, uid)) {
      throw new BadRequestException("You cannot report your own workflow.")
    }

    val alreadyReported = context.fetchExists(
      context
        .selectFrom(WORKFLOW_REPORT)
        .where(
          WORKFLOW_REPORT.WID
            .eq(wid)
            .and(WORKFLOW_REPORT.REPORTER_UID.eq(uid))
            .and(WORKFLOW_REPORT.STATUS.eq(ReportStatusEnum.PENDING))
        )
    )
    if (alreadyReported) {
      throw new BadRequestException("You have already reported this workflow.")
    }

    val report = new WorkflowReport()
    report.setWid(wid)
    report.setReporterUid(uid)
    report.setReason(reason)
    report.setDetail(Option(request.detail).map(_.trim).filter(_.nonEmpty).orNull)
    report.setStatus(ReportStatusEnum.PENDING)
    report.setCreationTime(new Timestamp(System.currentTimeMillis()))
    reportDao.insert(report)
  }

  /**
    * List all pending reports, most recent first. Admin only.
    */
  @GET
  @RolesAllowed(Array("ADMIN"))
  @Path("/list")
  def listPendingReports(): List[ReportEntry] = {
    val rows = context
      .select(
        WORKFLOW_REPORT.REPORT_ID.as("reportId"),
        WORKFLOW_REPORT.WID.as("wid"),
        WORKFLOW.NAME.as("workflowName"),
        WORKFLOW.IS_PUBLIC.as("isPublic"),
        WORKFLOW_REPORT.REPORTER_UID.as("reporterUid"),
        WORKFLOW_OF_USER.UID.as("ownerUid"),
        WORKFLOW_REPORT.REASON.as("reason"),
        WORKFLOW_REPORT.DETAIL.as("detail"),
        WORKFLOW_REPORT.STATUS.as("status"),
        WORKFLOW_REPORT.CREATION_TIME.as("creationTime")
      )
      .from(WORKFLOW_REPORT)
      .join(WORKFLOW)
      .on(WORKFLOW_REPORT.WID.eq(WORKFLOW.WID))
      .leftJoin(WORKFLOW_OF_USER)
      .on(WORKFLOW_OF_USER.WID.eq(WORKFLOW_REPORT.WID))
      .where(
        WORKFLOW_REPORT.STATUS
          .eq(ReportStatusEnum.PENDING)
          // Only surface reports for workflows that are still public; a workflow
          // that was unpublished (by any means) or deleted no longer needs review.
          .and(WORKFLOW.IS_PUBLIC.eq(true))
      )
      .orderBy(WORKFLOW_REPORT.CREATION_TIME.desc())
      .fetchInto(classOf[ReportRow])
      .asScala
      .toList

    val uids =
      (rows.map(_.reporterUid) ++ rows.flatMap(r => Option(r.ownerUid))).distinct
    val users: Map[Integer, (String, Boolean)] =
      if (uids.isEmpty) Map.empty
      else
        context
          .select(USER.UID, USER.NAME, USER.PUBLISH_DISABLED)
          .from(USER)
          .where(USER.UID.in(uids.asJava))
          .fetch()
          .asScala
          .map(r =>
            (r.get(USER.UID), (r.get(USER.NAME), r.get(USER.PUBLISH_DISABLED).booleanValue()))
          )
          .toMap

    rows.map { row =>
      val owner = Option(row.ownerUid).flatMap(users.get)
      ReportEntry(
        reportId = row.reportId,
        wid = row.wid,
        workflowName = row.workflowName,
        isPublic = row.isPublic,
        reporterName = users.get(row.reporterUid).map(_._1).getOrElse(""),
        ownerUid = row.ownerUid,
        ownerName = owner.map(_._1).getOrElse(""),
        ownerPublishDisabled = owner.exists(_._2),
        reason = row.reason,
        detail = row.detail,
        status = row.status,
        creationTime = row.creationTime
      )
    }
  }

  /**
    * Dismiss all pending reports for a workflow without taking action. Admin only.
    */
  @PUT
  @RolesAllowed(Array("ADMIN"))
  @Path("/dismiss/{wid}")
  def dismissReports(@PathParam("wid") wid: Integer, @Auth user: SessionUser): Unit = {
    resolvePendingReports(wid, ReportStatusEnum.CLOSED, user.getUid)
  }

  /**
    * Unpublish a reported workflow (flip it back to private) and mark its reports
    * as actioned. The owner keeps their private copy. Admin only.
    */
  @PUT
  @RolesAllowed(Array("ADMIN"))
  @Path("/unpublish/{wid}")
  def unpublishWorkflow(@PathParam("wid") wid: Integer, @Auth user: SessionUser): Unit = {
    val workflow: Workflow = workflowDao.fetchOneByWid(wid)
    if (workflow == null) {
      throw new NotFoundException(s"Workflow with id $wid not found")
    }
    workflow.setIsPublic(false)
    workflowDao.update(workflow)
    resolvePendingReports(wid, ReportStatusEnum.ACTIONED, user.getUid)
  }

  /**
    * Suspend or restore a user's right to publish workflows. Used to stop a repeat
    * offender whose public workflows keep getting taken down. Admin only.
    */
  @PUT
  @Consumes(Array(MediaType.APPLICATION_JSON))
  @RolesAllowed(Array("ADMIN"))
  @Path("/author/{uid}/publishing")
  def setAuthorPublishing(@PathParam("uid") uid: Integer, request: PublishingRequest): Unit = {
    context
      .update(USER)
      .set(USER.PUBLISH_DISABLED, java.lang.Boolean.valueOf(request.disabled))
      .where(USER.UID.eq(uid))
      .execute()
  }

  /**
    * The current user's own workflows that are currently unpublished because of a
    * moderation action. Used by the dashboard to flag them.
    */
  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/moderated")
  def moderatedWorkflows(@Auth user: SessionUser): List[Integer] = {
    context
      .selectDistinct(WORKFLOW_REPORT.WID)
      .from(WORKFLOW_REPORT)
      .join(WORKFLOW_OF_USER)
      .on(WORKFLOW_OF_USER.WID.eq(WORKFLOW_REPORT.WID))
      .join(WORKFLOW)
      .on(WORKFLOW.WID.eq(WORKFLOW_REPORT.WID))
      .where(
        WORKFLOW_OF_USER.UID
          .eq(user.getUid)
          .and(WORKFLOW_REPORT.STATUS.eq(ReportStatusEnum.ACTIONED))
          .and(WORKFLOW.IS_PUBLIC.eq(false))
      )
      .fetchInto(classOf[Integer])
      .asScala
      .toList
  }

  /**
    * Moderation notice for a single workflow, for its owner. Returns `unpublished =
    * false` for non-owners, missing workflows, or workflows that are still public.
    */
  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/moderation/{wid}")
  def moderationNotice(
      @PathParam("wid") wid: Integer,
      @Auth user: SessionUser
  ): ModerationNotice = {
    val workflow: Workflow = workflowDao.fetchOneByWid(wid)
    val takenDown = isOwner(wid, user.getUid) && workflow != null && !workflow.getIsPublic
    if (!takenDown) {
      ModerationNotice(unpublished = false, Nil, null)
    } else {
      val actioned = context
        .select(WORKFLOW_REPORT.REASON, WORKFLOW_REPORT.RESOLVED_TIME)
        .from(WORKFLOW_REPORT)
        .where(
          WORKFLOW_REPORT.WID
            .eq(wid)
            .and(WORKFLOW_REPORT.STATUS.eq(ReportStatusEnum.ACTIONED))
        )
        .orderBy(WORKFLOW_REPORT.RESOLVED_TIME.desc())
        .fetch()
      if (actioned.isEmpty) {
        ModerationNotice(unpublished = false, Nil, null)
      } else {
        val reasons = actioned.asScala.map(_.get(WORKFLOW_REPORT.REASON)).distinct.toList
        ModerationNotice(
          unpublished = true,
          reasons,
          actioned.get(0).get(WORKFLOW_REPORT.RESOLVED_TIME)
        )
      }
    }
  }

  private def resolvePendingReports(
      wid: Integer,
      status: ReportStatusEnum,
      resolverUid: Integer
  ): Unit = {
    context
      .update(WORKFLOW_REPORT)
      .set(WORKFLOW_REPORT.STATUS, status)
      .set(WORKFLOW_REPORT.RESOLVER_UID, resolverUid)
      .set(WORKFLOW_REPORT.RESOLVED_TIME, new Timestamp(System.currentTimeMillis()))
      .where(
        WORKFLOW_REPORT.WID
          .eq(wid)
          .and(WORKFLOW_REPORT.STATUS.eq(ReportStatusEnum.PENDING))
      )
      .execute()
  }
}
