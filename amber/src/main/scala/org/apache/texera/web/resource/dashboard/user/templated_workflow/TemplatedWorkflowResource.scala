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
import javax.ws.rs.{
  BadRequestException,
  ForbiddenException,
  GET,
  NotFoundException,
  POST,
  Path,
  PathParam,
  Produces,
  QueryParam
}
import org.apache.texera.web.service.{TemplateService, WorkflowPersistService}
import org.apache.texera.dao.jooq.generated.Tables.{WORKFLOW, WORKFLOW_OF_TEMPLATE}
import org.apache.texera.dao.jooq.generated.tables.pojos._
import org.apache.texera.web.resource.dashboard.user.templated_workflow.TemplatedWorkflowResource._
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowVersionResource
import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.databind.node.{ArrayNode, ObjectNode}
import com.fasterxml.jackson.module.scala.DefaultScalaModule

import scala.jdk.CollectionConverters._

/**
  * Request body for POST /templated-workflow/{wid}/update: maps an operatorID to the subset of its
  * properties the user wants to change. Values are kept as raw JsonNode so any property type
  * (including file references) round-trips without lossy conversion.
  */
class TemplatedWorkflowConfigurablePropertiesUpdateRequest {
  var operatorProperties: Map[String, Map[String, JsonNode]] = Map.empty
  // Optional name for the workflow created by /instantiate. When blank, the template's name is used.
  var name: String = _
}

/**
  * One workflow<->template link, returned by GET /templated-workflow/list so the dashboard can mark
  * which workflows were created from a template ("created from template" tag).
  */
case class TemplatedWorkflowInfo(wid: Integer, tid: Integer)

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
    // jOOQ POJO constructor follows the physical column order (tid, wid, parameters); the
    // migration only moved the PRIMARY KEY to wid, it did NOT reorder columns.
    workflowOfTemplateDao.insert(new WorkflowOfTemplate(tid, wid, parameters))
  }

  private def getTemplatedWorkflowIdIfExists(tid: Integer): Option[Integer] = {
    Option(
      context
        .select(WORKFLOW_OF_TEMPLATE.WID)
        .from(WORKFLOW_OF_TEMPLATE)
        .where(WORKFLOW_OF_TEMPLATE.TID.eq(tid))
        .fetchAny(WORKFLOW_OF_TEMPLATE.WID)
    )
  }

  /**
    * The set of property names an operator allows to be configured, read from the operator's
    * `configurableProperties` array in the workflow content. The /update endpoint refuses to write
    * any property outside this whitelist.
    */
  private def getAllowedConfigurableProperties(operatorObject: ObjectNode): Set[String] = {
    val configurablePropertiesNode = operatorObject.get("configurableProperties")

    if (configurablePropertiesNode == null || configurablePropertiesNode.isNull) {
      return Set.empty
    }

    if (!configurablePropertiesNode.isArray) {
      throw new BadRequestException("Operator configurableProperties must be an array.")
    }

    configurablePropertiesNode
      .asInstanceOf[ArrayNode]
      .elements()
      .asScala
      .map { propertyNode =>
        if (!propertyNode.isTextual) {
          throw new BadRequestException("Each configurableProperties entry must be a string.")
        }
        propertyNode.asText()
      }
      .toSet
  }

  private def getOrCreateOperatorPropertiesObject(
      operatorObject: ObjectNode,
      objectMapper: ObjectMapper
  ): ObjectNode = {
    val operatorPropertiesNode = operatorObject.get("operatorProperties")

    if (operatorPropertiesNode == null || operatorPropertiesNode.isNull) {
      val newOperatorProperties = objectMapper.createObjectNode()
      operatorObject.set[JsonNode]("operatorProperties", newOperatorProperties)
      return newOperatorProperties
    }

    if (!operatorPropertiesNode.isObject) {
      throw new BadRequestException("operatorProperties must be an object.")
    }

    operatorPropertiesNode.asInstanceOf[ObjectNode]
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

  /**
    * Lists every workflow<->template link (wid, tid). The dashboard intersects this with the
    * workflows it shows so it can tag the ones created from a template. The set is small, and it
    * only exposes the wid<->tid mapping.
    */
  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/list")
  def listTemplatedWorkflows(@Auth user: SessionUser): List[TemplatedWorkflowInfo] = {
    context
      .select(WORKFLOW_OF_TEMPLATE.WID, WORKFLOW_OF_TEMPLATE.TID)
      .from(WORKFLOW_OF_TEMPLATE)
      .fetch()
      .asScala
      .map(r => TemplatedWorkflowInfo(r.get(WORKFLOW_OF_TEMPLATE.WID), r.get(WORKFLOW_OF_TEMPLATE.TID)))
      .toList
  }

  /**
    * Returns the workflow instantiated from template `tid`, creating it (once) from the template's
    * content on first call. Does NOT re-apply template content on subsequent calls, so a user's
    * configured property values are never clobbered -- property changes go through /{wid}/update.
    */
  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/build")
  def buildTemplatedWorkflowIfNotExists(
      @QueryParam("tid") tid: Integer,
      @Auth user: SessionUser
  ): Integer = {
    // Idempotent get-or-create: the build page calls this on open to show a runnable preview, so it
    // must NOT spawn a new workflow on every open. Return the existing workflow for this template if
    // there is one; otherwise create it once, owned by the caller with WRITE access (default) so the
    // preview is a normal, fully-editable/runnable workflow.
    getTemplatedWorkflowIdIfExists(tid) match {
      case Some(wid) =>
        val workflow = workflowDao.fetchOneByWid(wid)
        if (workflow == null) {
          throw new NotFoundException(s"Templated workflow $wid does not exist.")
        }
        wid
      case None =>
        val template = templateService.retrieveTemplate(tid)
        val templatedWorkflow = new Workflow(
          null, // wid
          template.name, // name
          template.description, // description
          template.content, // content
          null, // creationTime
          null, // lastModifiedTime
          false // isPublic
        )
        val workflow = workflowPersistService.createWorkflow(templatedWorkflow, user)
        val newWid = workflow.workflow.getWid
        buildTemplatedWorkflowRelation(tid, newWid, "")
        newWid
    }
  }

  /**
    * Applies the submitted configurable-property values to the instantiated workflow's content,
    * server-side. Only properties listed in each operator's `configurableProperties` whitelist may
    * be written; values are stored as-is (JsonNode) so file references and other typed values
    * survive. A new workflow version is recorded.
    */
  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}/update")
  def updateTemplatedWorkflowConfigurableProperties(
      @PathParam("wid") wid: Integer,
      request: TemplatedWorkflowConfigurablePropertiesUpdateRequest,
      @Auth sessionUser: SessionUser
  ): Workflow = {
    val user = sessionUser.getUser
    if (user == org.apache.texera.web.auth.GuestAuthFilter.GUEST) {
      throw new ForbiddenException("Guest user does not have access to db.")
    }

    if (wid == null) {
      throw new BadRequestException("Workflow id cannot be null.")
    }

    if (
      request == null || request.operatorProperties == null || request.operatorProperties.isEmpty
    ) {
      throw new BadRequestException("No configurable properties were provided.")
    }

    val workflow = workflowDao.fetchOneByWid(wid)
    if (workflow == null) {
      throw new NotFoundException(s"Workflow $wid does not exist.")
    }

    val objectMapper = new ObjectMapper()
    objectMapper.registerModule(DefaultScalaModule)

    val content = objectMapper.readTree(workflow.getContent)
    if (content == null || !content.isObject) {
      throw new BadRequestException("Workflow content is invalid.")
    }

    val contentObject = content.asInstanceOf[ObjectNode]
    val operatorsNode = contentObject.get("operators")

    if (operatorsNode == null || !operatorsNode.isArray) {
      throw new BadRequestException("Workflow content does not contain operators.")
    }

    val operatorsById: Map[String, ObjectNode] = operatorsNode
      .asInstanceOf[ArrayNode]
      .elements()
      .asScala
      .map { operatorNode =>
        if (!operatorNode.isObject) {
          throw new BadRequestException("Workflow contains an invalid operator.")
        }

        val operatorObject = operatorNode.asInstanceOf[ObjectNode]
        val operatorIdNode = operatorObject.get("operatorID")

        if (operatorIdNode == null || !operatorIdNode.isTextual) {
          throw new BadRequestException("Workflow contains an operator without operatorID.")
        }

        operatorIdNode.asText() -> operatorObject
      }
      .toMap

    request.operatorProperties.foreach {
      case (operatorId, submittedProperties) =>
        val operatorObject = operatorsById.getOrElse(
          operatorId,
          throw new BadRequestException(s"Operator $operatorId does not exist in workflow $wid.")
        )

        val allowedProperties = getAllowedConfigurableProperties(operatorObject)

        if (allowedProperties.isEmpty) {
          throw new BadRequestException(s"Operator $operatorId has no configurable properties.")
        }

        if (submittedProperties == null) {
          throw new BadRequestException(
            s"Submitted properties for operator $operatorId cannot be null."
          )
        }

        val operatorPropertiesObject =
          getOrCreateOperatorPropertiesObject(operatorObject, objectMapper)

        submittedProperties.foreach {
          case (propertyName, propertyValue) =>
            if (!allowedProperties.contains(propertyName)) {
              throw new BadRequestException(
                s"Property $propertyName is not configurable for operator $operatorId."
              )
            }
            operatorPropertiesObject.set[JsonNode](propertyName, propertyValue)
        }
    }

    workflow.setContent(objectMapper.writeValueAsString(contentObject))

    WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = false)
    // Update ONLY the content column. Using workflowDao.update(workflow) rewrites the whole record,
    // and jOOQ re-stamps the timestamp columns truncated to whole seconds -- that loses the
    // sub-second precision a freshly-created workflow gets from the DB default, so several workflows
    // created in the same second sort arbitrarily and a newly instantiated one may not appear at the
    // top of the list. A targeted content update leaves creation/last-modified untouched, keeping the
    // generated workflow's timestamps identical to a normal workflow's.
    context
      .update(WORKFLOW)
      .set(WORKFLOW.CONTENT, workflow.getContent)
      .where(WORKFLOW.WID.eq(wid))
      .execute()

    workflowDao.fetchOneByWid(wid)
  }

  /**
    * 1-to-n: create a brand-new workflow from the template and apply the submitted configurable
    * properties to it. Every call yields a separate workflow that is recorded in
    * workflow_of_template (so it carries the "created from template" tag) and owned by the caller
    * with WRITE access. Returns the new wid. The build page calls this on Submit.
    */
  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/instantiate")
  def instantiateTemplatedWorkflow(
      @QueryParam("tid") tid: Integer,
      request: TemplatedWorkflowConfigurablePropertiesUpdateRequest,
      @Auth sessionUser: SessionUser
  ): Integer = {
    val template = templateService.retrieveTemplate(tid)
    // Honor a user-chosen name from the build page; fall back to the template's name when blank.
    val workflowName =
      if (request != null && request.name != null && request.name.trim.nonEmpty) request.name.trim
      else template.name
    val newWorkflow = new Workflow(
      null, // wid
      workflowName, // name
      template.description, // description
      template.content, // content
      null, // creationTime
      null, // lastModifiedTime
      false // isPublic
    )
    val created = workflowPersistService.createWorkflow(newWorkflow, sessionUser)
    val newWid = created.workflow.getWid
    buildTemplatedWorkflowRelation(tid, newWid, "")
    // Reuse /update's whitelisted apply logic on the new workflow, if any properties were submitted.
    if (request != null && request.operatorProperties != null && request.operatorProperties.nonEmpty) {
      updateTemplatedWorkflowConfigurableProperties(newWid, request, sessionUser)
    }
    newWid
  }
}
