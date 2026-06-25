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

import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.tables.daos.{WorkflowDao, WorkflowOfTemplateDao}

import javax.annotation.security.RolesAllowed
import javax.ws.rs.core.MediaType
import javax.ws.rs.{POST, Path, Produces, QueryParam}
import org.apache.texera.web.service.{TemplateService, WorkflowPersistService}
import org.apache.texera.dao.jooq.generated.Tables.WORKFLOW_OF_TEMPLATE
import org.apache.texera.dao.jooq.generated.tables.pojos._
import org.apache.texera.web.resource.dashboard.user.templated_workflow.TemplatedWorkflowResource._
import org.apache.texera.dao.jooq.generated.enums.PrivilegeEnum

object TemplatedWorkflowResource {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()
  final private lazy val workflowDao = new WorkflowDao(context.configuration)
  final private lazy val workflowOfTemplateDao = new WorkflowOfTemplateDao(
    context.configuration
  )

  private def buildTemplatedWorkflowRelation(
      tid: Integer,
      wid: Integer,
      parameters: String
  ): Unit = {
    workflowOfTemplateDao.insert(new WorkflowOfTemplate(tid, wid, parameters))
  }

  private def getTemplatedWorkflowIdIfExists(tid: Integer): Option[Integer] = {
    Option(
      context
        .select(WORKFLOW_OF_TEMPLATE.WID)
        .from(WORKFLOW_OF_TEMPLATE)
        .where(WORKFLOW_OF_TEMPLATE.TID.eq(tid))
        .fetchOneInto(classOf[Integer])
    )
  }
}

@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/templated-workflow")
class TemplatedWorkflowResource extends LazyLogging {
  final private lazy val context = SqlServer
    .getInstance()
    .createDSLContext()

  private val templateService = new TemplateService(context)
  private val workflowPersistService = new WorkflowPersistService(context)

  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/build")
  def buildTemplatedWorkflowIfNotExists(
      @QueryParam("tid") tid: Integer,
      @Auth user: SessionUser
  ): Integer = {
    val wid: Option[Integer] = getTemplatedWorkflowIdIfExists(tid)
    val template = templateService.retrieveTemplate(tid)
    wid match {
      case Some(wid) =>
        val workflow = workflowDao.fetchOneByWid(wid)
        workflow.setContent(template.content)
        workflowPersistService.persistWorkflow(workflow, user)
        wid

      case None =>
        val templatedWorkflow = new Workflow(
          null, // wid
          template.name, // name
          template.description, // description
          template.content, // content
          null, // creationTime
          null, // lastModifiedTime
          false // isPublic
        )
        val workflow =
          workflowPersistService.createWorkflow(
            templatedWorkflow,
            user,
            privilege = PrivilegeEnum.READ
          )
        val newWid = workflow.workflow.getWid
        buildTemplatedWorkflowRelation(tid, newWid, "")
        newWid
    }
  }
}
