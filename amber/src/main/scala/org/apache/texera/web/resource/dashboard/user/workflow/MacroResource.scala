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

import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.module.scala.DefaultScalaModule
import com.typesafe.scalalogging.LazyLogging
import io.dropwizard.auth.Auth
import org.apache.texera.amber.operator.macroOp.MacroPortSpec
import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.SqlServer
import org.apache.texera.dao.jooq.generated.Tables._
import org.apache.texera.dao.jooq.generated.enums.{PrivilegeEnum, WorkflowKindEnum}
import org.apache.texera.dao.jooq.generated.tables.daos.{
  MacroMetadataDao,
  WorkflowDao,
  WorkflowOfTemplateDao,
  WorkflowOfUserDao,
  WorkflowUserAccessDao
}
import org.apache.texera.dao.jooq.generated.tables.pojos.{
  MacroMetadata,
  Workflow,
  WorkflowOfTemplate,
  WorkflowOfUser,
  WorkflowUserAccess
}
import org.apache.texera.web.resource.dashboard.user.workflow.MacroResource._
import org.apache.texera.web.resource.dashboard.user.workflow.WorkflowAccessResource.{
  hasReadAccess,
  hasWriteAccess
}
import org.jooq.{DSLContext, JSONB}

import java.sql.Timestamp
import javax.annotation.security.RolesAllowed
import javax.ws.rs._
import javax.ws.rs.core.MediaType
import scala.jdk.CollectionConverters._

/**
  * REST endpoints for macro definitions. A macro is persisted as a `workflow`
  * row with `kind = MACRO` plus a side row in `macro_metadata` carrying the
  * denormalized port / parameter / palette-display fields.
  *
  * Macros reuse the workflow ACL machinery (`workflow_user_access`), so the
  * standard `WorkflowAccessResource.hasReadAccess` / `hasWriteAccess` apply
  * unchanged here.
  */
object MacroResource {

  private def context: DSLContext = SqlServer.getInstance().createDSLContext()
  private def workflowDao = new WorkflowDao(context.configuration)
  private def workflowOfUserDao = new WorkflowOfUserDao(context.configuration)
  private def workflowOfTemplateDao = new WorkflowOfTemplateDao(context.configuration)
  private def workflowUserAccessDao = new WorkflowUserAccessDao(context.configuration)
  private def macroMetadataDao = new MacroMetadataDao(context.configuration)

  // Local mapper for the JSONB columns. The Scala module lets PortSpec and
  // MacroPortSpec round-trip as case classes without extra annotations.
  private val mapper: ObjectMapper = new ObjectMapper().registerModule(DefaultScalaModule)

  /** Request body for `POST /macro/create`. */
  case class MacroCreateRequest(
      name: String,
      description: Option[String] = None,
      content: String,
      isPublic: Boolean = false,
      portSpec: PortSpec,
      paramSpec: Option[JsonNode] = None,
      category: Option[String] = None,
      icon: Option[String] = None
  )

  /** Declared external boundary of a macro. */
  case class PortSpec(
      inputs: List[MacroPortSpec] = Nil,
      outputs: List[MacroPortSpec] = Nil
  )

  /**
    * Request body for `POST /macro/{wid}/generate-workflow`. `content` is the
    * already-expanded, marker-stripped, param-patched workflow content produced
    * on the frontend (macroDetailToGeneratedContent + form overlay).
    */
  case class GenerateWorkflowRequest(
      name: String,
      content: String,
      description: Option[String] = None,
      preview: Boolean = false
  )

  /**
    * Request body for `POST /macro/{wid}/configurable-properties`. Maps each
    * body operator id to the list of its property names that are exposed as
    * configurable in Template mode (the whitelist). Stored in
    * `macro_metadata.param_spec` -- the macro body content is never touched.
    */
  case class UpdateConfigurablePropertiesRequest(
      configurableProperties: Map[String, List[String]] = Map.empty
  )

  /**
    * Request body for `POST /macro/{wid}/body`. `content` is the edited macro
    * body serialized as a MacroBody JSON string (operators incl. MacroInput/
    * MacroOutput markers, links, inputs, outputs) -- the same shape the macro's
    * `workflow.content` already holds. Produced by the frontend editor's
    * workflowContentToMacroBody serializer.
    */
  case class UpdateMacroBodyRequest(content: String)

  /** Full response for `POST /macro/create` and `GET /macro/{wid}`. */
  case class MacroDetail(
      wid: Integer,
      name: String,
      description: String,
      content: String,
      creationTime: Timestamp,
      lastModifiedTime: Timestamp,
      isPublic: Boolean,
      portSpec: PortSpec,
      paramSpec: JsonNode,
      category: Option[String],
      icon: Option[String],
      isOwner: Boolean,
      readonly: Boolean
  )

  /**
    * Lightweight row for `GET /macro/list`. `content` is intentionally omitted
    * so the operator palette can render without pulling large LogicalPlan blobs
    * over the wire. `usageCount` is the number of distinct non-macro workflows
    * (visible to the requesting user) whose `content` references this macro
    * by `"macroId":"<wid>"`. Surfaced in the "Your Macros" palette as a small
    * "Nx" chip so users can see at a glance how reusable a macro is.
    */
  case class MacroSummary(
      wid: Integer,
      name: String,
      description: String,
      creationTime: Timestamp,
      lastModifiedTime: Timestamp,
      portSpec: PortSpec,
      category: Option[String],
      icon: Option[String],
      usageCount: Int,
      isOwner: Boolean,
      ownerName: String,
      // Operator types present in the macro body (markers included). The
      // frontend maps these to input-port counts via its already-loaded
      // OperatorMetadataService to decide "runnable" (0 external inputs AND a
      // body source op). Kept as bare type strings so the list stays light and
      // the backend needs no per-operator port metadata of its own.
      bodyOperatorTypes: List[String]
  )

  /**
    * Per-instance schema returned by `GET /macro/{wid}/schema`. In Phase 1 this
    * holds the port spec only; Phase 2 will populate `params` from promoted
    * parameters declared inside the macro body.
    */
  case class MacroSchema(
      inputs: List[MacroPortSpec],
      outputs: List[MacroPortSpec],
      params: List[JsonNode]
  )

  private def jsonbOf[T](value: T): JSONB =
    JSONB.valueOf(mapper.writeValueAsString(value))

  private def jsonbOfNode(node: JsonNode): JSONB =
    JSONB.valueOf(mapper.writeValueAsString(node))

  private def parsePortSpec(jsonb: JSONB): PortSpec =
    Option(jsonb)
      .map(j => mapper.readValue(j.data(), classOf[PortSpec]))
      .getOrElse(PortSpec())

  private def parseParamSpec(jsonb: JSONB): JsonNode =
    Option(jsonb)
      .map(j => mapper.readTree(j.data()))
      .getOrElse(mapper.createArrayNode())

  /**
    * Pull the operator types out of a macro body's JSON (`operators[].operatorType`).
    * Best-effort: malformed / null content yields Nil. This is all the runnable
    * check needs from the backend -- the frontend does the port-count lookup.
    */
  private def bodyOperatorTypesOf(content: String): List[String] =
    Option(content)
      .flatMap(c =>
        scala.util
          .Try {
            val ops = mapper.readTree(c).get("operators")
            if (ops != null && ops.isArray)
              ops.elements().asScala.flatMap(n => Option(n.get("operatorType")).map(_.asText)).toList
            else Nil
          }
          .toOption
      )
      .getOrElse(Nil)
}

@Produces(Array(MediaType.APPLICATION_JSON))
@Path("/macro")
class MacroResource extends LazyLogging {

  @POST
  @Consumes(Array(MediaType.APPLICATION_JSON))
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/create")
  def create(req: MacroCreateRequest, @Auth sessionUser: SessionUser): MacroDetail = {
    val user = sessionUser.getUser

    val workflow = new Workflow()
    workflow.setName(req.name)
    workflow.setDescription(req.description.orNull)
    workflow.setContent(req.content)
    workflow.setIsPublic(req.isPublic)
    workflow.setKind(WorkflowKindEnum.MACRO)
    workflowDao.insert(workflow)

    workflowOfUserDao.insert(new WorkflowOfUser(user.getUid, workflow.getWid))
    workflowUserAccessDao.insert(
      new WorkflowUserAccess(user.getUid, workflow.getWid, PrivilegeEnum.WRITE)
    )

    // Seed v1 of the macro so LIVE-mode instances can pin to a concrete vid.
    WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = true)

    val metadata = new MacroMetadata(
      workflow.getWid,
      jsonbOf(req.portSpec),
      jsonbOfNode(req.paramSpec.getOrElse(mapper.createArrayNode())),
      req.category.orNull,
      req.icon.orNull
    )
    macroMetadataDao.insert(metadata)

    toDetail(
      workflowDao.fetchOneByWid(workflow.getWid),
      metadata,
      isOwner = true,
      readonly = false
    )
  }

  /**
    * Generate an independent, normal (kind=WORKFLOW) workflow from a macro
    * definition (= the unified "Template" flow). The caller sends the already
    * expanded + param-patched content; this persists it as a new workflow the
    * user owns and records the 1-to-n macro->workflow relation in
    * workflow_of_template (tid = source macro wid). No runnable gate: a
    * not-runnable macro yields a workflow with unconnected inputs (Invalid
    * Workflow) the user completes by adding a data source.
    */
  @POST
  @Consumes(Array(MediaType.APPLICATION_JSON))
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}/generate-workflow")
  def generateWorkflow(
      @PathParam("wid") wid: Integer,
      req: GenerateWorkflowRequest,
      @Auth sessionUser: SessionUser
  ): Integer = {
    val user = sessionUser.getUser
    if (!hasReadAccess(wid, user.getUid)) {
      throw new ForbiddenException("No sufficient access privilege.")
    }
    // By design this endpoint does NOT validate "runnable". The runnable gate
    // (a macro must have no unbound inputs AND a body source op before it can
    // be generated) lives on the frontend -- it is a product guardrail, not a
    // security boundary. Bypassing it (e.g. a hand-crafted POST) only yields a
    // workflow with unconnected inputs, i.e. a harmless Invalid Workflow the
    // user must complete before running. Access control IS still enforced
    // (hasReadAccess above). Intentional -- not a missing check.
    val name =
      if (req.name != null && req.name.trim.nonEmpty) req.name.trim else "Generated workflow"

    val workflow = new Workflow()
    workflow.setName(name)
    req.description.filter(_.trim.nonEmpty).foreach(d => workflow.setDescription(d))
    workflow.setContent(req.content)
    workflow.setIsPublic(false)
    workflow.setKind(WorkflowKindEnum.WORKFLOW)
    workflowDao.insert(workflow)
    val newWid = workflow.getWid

    workflowOfUserDao.insert(new WorkflowOfUser(user.getUid, newWid))
    workflowUserAccessDao.insert(new WorkflowUserAccess(user.getUid, newWid, PrivilegeEnum.WRITE))
    WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = true)

    // 1-to-n: record source macro (tid) -> generated workflow (wid). A preview
    // is the throwaway workflow backing the Generate page's embedded canvas;
    // marked "preview" so it's filtered out of the Workflows list.
    workflowOfTemplateDao.insert(
      new WorkflowOfTemplate(wid, newWid, if (req.preview) "preview" else "")
    )

    newWid
  }


  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/list")
  def list(@Auth sessionUser: SessionUser): List[MacroSummary] = {
    val uid = sessionUser.getUser.getUid
    val rows = context
      .selectDistinct(
        WORKFLOW.WID,
        WORKFLOW.NAME,
        WORKFLOW.DESCRIPTION,
        WORKFLOW.CREATION_TIME,
        WORKFLOW.LAST_MODIFIED_TIME,
        MACRO_METADATA.PORT_SPEC,
        MACRO_METADATA.CATEGORY,
        MACRO_METADATA.ICON,
        WORKFLOW_OF_USER.UID,
        USER.NAME,
        WORKFLOW.CONTENT
      )
      .from(WORKFLOW)
      .join(WORKFLOW_USER_ACCESS)
      .on(WORKFLOW_USER_ACCESS.WID.eq(WORKFLOW.WID))
      .leftJoin(MACRO_METADATA)
      .on(MACRO_METADATA.WID.eq(WORKFLOW.WID))
      .leftJoin(WORKFLOW_OF_USER)
      .on(WORKFLOW_OF_USER.WID.eq(WORKFLOW.WID))
      .leftJoin(USER)
      .on(USER.UID.eq(WORKFLOW_OF_USER.UID))
      .where(WORKFLOW.KIND.eq(WorkflowKindEnum.MACRO))
      .and(WORKFLOW_USER_ACCESS.UID.eq(uid))
      .fetch()

    val usageMap = computeMacroUsage(uid)
    rows.asScala.map { r =>
      MacroSummary(
        r.value1(),
        r.value2(),
        r.value3(),
        r.value4(),
        r.value5(),
        parsePortSpec(r.value6()),
        Option(r.value7()),
        Option(r.value8()),
        usageMap.getOrElse(r.value1().intValue(), 0),
        isOwner = r.value9() != null && r.value9() == uid,
        ownerName = Option(r.value10()).getOrElse(""),
        bodyOperatorTypes = bodyOperatorTypesOf(r.value11())
      )
    }.toList
  }

  /**
    * For each macro the user can see, count the distinct non-macro workflows
    * (also user-visible) whose `content` JSON embeds the macro's wid via
    * `"macroId":"<wid>"`. The regex is robust to whitespace variants Jackson
    * may produce.
    *
    * One pass over the user's non-macro workflows; no per-macro round-trip.
    * Cost = O(workflows × content-length). For typical Texera installs
    * (hundreds of workflows, < 100KB each) this is well under a millisecond.
    */
  private def computeMacroUsage(uid: Integer): Map[Int, Int] = {
    val contents = context
      .selectDistinct(WORKFLOW.WID, WORKFLOW.CONTENT)
      .from(WORKFLOW)
      .join(WORKFLOW_USER_ACCESS)
      .on(WORKFLOW_USER_ACCESS.WID.eq(WORKFLOW.WID))
      .where(WORKFLOW.KIND.ne(WorkflowKindEnum.MACRO))
      .and(WORKFLOW_USER_ACCESS.UID.eq(uid))
      .fetch()
    val macroIdRegex = """"macroId"\s*:\s*"(\d+)"""".r
    val counts = scala.collection.mutable.Map[Int, Int]().withDefaultValue(0)
    for (r <- contents.asScala) {
      val content = r.value2()
      if (content != null) {
        // De-dup within a single workflow: one workflow contributes +1 per
        // distinct macroId it references, not per occurrence. The UI surfaces
        // this as "used in N workflows".
        val widsInThisWorkflow = scala.collection.mutable.Set[Int]()
        for (m <- macroIdRegex.findAllMatchIn(content)) {
          widsInThisWorkflow += m.group(1).toInt
        }
        widsInThisWorkflow.foreach(wid => counts(wid) = counts(wid) + 1)
      }
    }
    counts.toMap
  }

  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}")
  def get(@PathParam("wid") wid: Integer, @Auth sessionUser: SessionUser): MacroDetail = {
    val uid = sessionUser.getUser.getUid
    if (!hasReadAccess(wid, uid)) {
      throw new ForbiddenException("No sufficient access privilege.")
    }
    val workflow = Option(workflowDao.fetchOneByWid(wid))
      .filter(_.getKind == WorkflowKindEnum.MACRO)
      .getOrElse(throw new NotFoundException(s"Macro $wid not found"))
    val metadata = Option(macroMetadataDao.fetchOneByWid(wid))
      .getOrElse(throw new NotFoundException(s"Macro $wid metadata missing"))
    toDetail(workflow, metadata, isOwner = isOwner(wid, uid), readonly = !hasWriteAccess(wid, uid))
  }

  @GET
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}/schema")
  def schema(
      @PathParam("wid") wid: Integer,
      @Auth sessionUser: SessionUser
  ): MacroSchema = {
    val uid = sessionUser.getUser.getUid
    if (!hasReadAccess(wid, uid)) {
      throw new ForbiddenException("No sufficient access privilege.")
    }
    val metadata = Option(macroMetadataDao.fetchOneByWid(wid))
      .getOrElse(throw new NotFoundException(s"Macro $wid metadata missing"))
    val ports = parsePortSpec(metadata.getPortSpec)
    MacroSchema(ports.inputs, ports.outputs, params = Nil)
  }

  /**
    * Returns the macro's serialized body so the frontend can inline it into a
    * parent workflow as a SNAPSHOT instance (`MacroOpDesc.linkMode = SNAPSHOT`),
    * detaching that instance from any future edits to the macro definition.
    */
  @POST
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}/snapshot-into-instance")
  def snapshotIntoInstance(
      @PathParam("wid") wid: Integer,
      @Auth sessionUser: SessionUser
  ): String = {
    val uid = sessionUser.getUser.getUid
    if (!hasReadAccess(wid, uid)) {
      throw new ForbiddenException("No sufficient access privilege.")
    }
    Option(workflowDao.fetchOneByWid(wid))
      .filter(_.getKind == WorkflowKindEnum.MACRO)
      .map(_.getContent)
      .getOrElse(throw new NotFoundException(s"Macro $wid not found"))
  }

  /**
    * Save the Template-mode configurable-property whitelist for this macro.
    * The whitelist (opId -> configurable prop names) is stored in
    * `macro_metadata.param_spec` ONLY -- the macro body content is untouched,
    * so no workflow version is created and LIVE instances are unaffected. This
    * is a macro-definition write (write access required); it changes what
    * future Template-mode generations expose, nothing else.
    */
  @POST
  @Consumes(Array(MediaType.APPLICATION_JSON))
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}/configurable-properties")
  def updateConfigurableProperties(
      @PathParam("wid") wid: Integer,
      req: UpdateConfigurablePropertiesRequest,
      @Auth sessionUser: SessionUser
  ): Unit = {
    val uid = sessionUser.getUser.getUid
    if (!hasWriteAccess(wid, uid)) {
      throw new ForbiddenException("No sufficient access privilege.")
    }
    val metadata = Option(macroMetadataDao.fetchOneByWid(wid))
      .getOrElse(throw new NotFoundException(s"Macro $wid metadata missing"))
    metadata.setParamSpec(jsonbOfNode(mapper.valueToTree[JsonNode](req.configurableProperties)))
    macroMetadataDao.update(metadata)
  }

  /**
    * Save an edited macro body (from the Edit-macro canvas). Overwrites the
    * macro definition's `workflow.content` with the new MacroBody JSON and
    * records a new version. Write access required. NOTE: this mutates the
    * shared definition -- LIVE references pick up the change on their next
    * run (there is only LIVE today; the live/snapshot choice + prompt-on-update
    * lands in the follow-up commit). port_spec metadata is refreshed from the
    * body's MacroInput/MacroOutput markers so the palette/runnable view stays
    * in sync with the edited boundary.
    */
  @POST
  @Consumes(Array(MediaType.APPLICATION_JSON))
  @RolesAllowed(Array("REGULAR", "ADMIN"))
  @Path("/{wid}/body")
  def updateMacroBody(
      @PathParam("wid") wid: Integer,
      req: UpdateMacroBodyRequest,
      @Auth sessionUser: SessionUser
  ): Unit = {
    val uid = sessionUser.getUser.getUid
    if (!hasWriteAccess(wid, uid)) {
      throw new ForbiddenException("No sufficient access privilege.")
    }
    val workflow = Option(workflowDao.fetchOneByWid(wid))
      .filter(_.getKind == WorkflowKindEnum.MACRO)
      .getOrElse(throw new NotFoundException(s"Macro $wid not found"))
    workflow.setContent(req.content)
    workflowDao.update(workflow)
    WorkflowVersionResource.insertVersion(workflow, insertingNewWorkflow = false)

    // Keep macro_metadata.port_spec aligned with the edited body's boundary
    // markers so the Macros list (ports + runnable) reflects the new shape.
    val body = mapper.readTree(req.content)
    val ops = Option(body.get("operators"))
    def portsOf(markerType: String): List[MacroPortSpec] =
      ops
        .filter(_.isArray)
        .map(_.elements().asScala.toList)
        .getOrElse(Nil)
        .filter(op => Option(op.get("operatorType")).map(_.asText).contains(markerType))
        .flatMap(op => Option(op.get("portIndex")).map(_.asInt))
        .sorted
        .map(i => MacroPortSpec(i))
    Option(macroMetadataDao.fetchOneByWid(wid)).foreach { metadata =>
      metadata.setPortSpec(
        jsonbOf(PortSpec(portsOf("MacroInput"), portsOf("MacroOutput")))
      )
      macroMetadataDao.update(metadata)
    }
  }

  private def isOwner(wid: Integer, uid: Integer): Boolean =
    context
      .selectCount()
      .from(WORKFLOW_OF_USER)
      .where(WORKFLOW_OF_USER.WID.eq(wid).and(WORKFLOW_OF_USER.UID.eq(uid)))
      .fetchOne(0, classOf[Integer]) > 0

  private def toDetail(
      workflow: Workflow,
      metadata: MacroMetadata,
      isOwner: Boolean,
      readonly: Boolean
  ): MacroDetail =
    MacroDetail(
      workflow.getWid,
      workflow.getName,
      workflow.getDescription,
      workflow.getContent,
      workflow.getCreationTime,
      workflow.getLastModifiedTime,
      workflow.getIsPublic,
      parsePortSpec(metadata.getPortSpec),
      parseParamSpec(metadata.getParamSpec),
      Option(metadata.getCategory),
      Option(metadata.getIcon),
      isOwner,
      readonly
    )
}
