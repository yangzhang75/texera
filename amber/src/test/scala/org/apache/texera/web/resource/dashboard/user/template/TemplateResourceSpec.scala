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

package org.apache.texera.web.resource.dashboard.user.template

import org.apache.texera.auth.SessionUser
import org.apache.texera.dao.MockTexeraDB
import org.apache.texera.dao.jooq.generated.tables.daos.UserDao
import org.apache.texera.dao.jooq.generated.tables.pojos.{Template, User}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

import javax.ws.rs.ForbiddenException
import java.util.UUID

/** Covers the access/visibility rules of TemplateResource (public/private + who can see/open). */
class TemplateResourceSpec
    extends AnyFlatSpec
    with BeforeAndAfterAll
    with Matchers
    with MockTexeraDB {

  private val ownerUid = 7000 + scala.util.Random.nextInt(1000)
  private val otherUid = 8000 + scala.util.Random.nextInt(1000)

  private lazy val resource = new TemplateResource()

  private def session(uid: Int): SessionUser = {
    val user = new User
    user.setUid(uid)
    new SessionUser(user)
  }

  private val content =
    """{"operators":[{"operatorID":"TextInput-operator-1","operatorType":"TextInput",""" +
      """"configurableProperties":["fileName"],"operatorProperties":{"fileName":"a.csv"}}],""" +
      """"operatorPositions":{},"links":[],"commentBoxes":[],"settings":{"dataTransferBatchSize":400}}"""

  /** Create a template owned by the given session; returns the new tid. */
  private def createOwnedTemplate(owner: SessionUser): Integer = {
    val t = new Template
    t.setName("spec_template")
    t.setDescription("d")
    t.setContent(content)
    t.setConfigurableParameters("")
    resource.createTemplate(t, owner)
    t.getTid
  }

  private def registerUser(uid: Int): Unit = {
    val userDao = new UserDao(getDSLContext.configuration())
    val user = new User
    user.setUid(uid)
    user.setName(s"user_$uid")
    user.setEmail(s"user_${UUID.randomUUID()}@example.com")
    user.setPassword("password")
    userDao.insert(user)
  }

  override protected def beforeAll(): Unit = {
    initializeDBAndReplaceDSLContext()
    registerUser(ownerUid)
    registerUser(otherUid)
  }

  override protected def afterAll(): Unit = shutdownDB()

  "makePublic/makePrivate" should "let the owner toggle visibility, reflected by getTemplateType" in {
    val tid = createOwnedTemplate(session(ownerUid))
    resource.getTemplateType(tid) shouldBe "Private"
    resource.makePublic(tid, session(ownerUid))
    resource.getTemplateType(tid) shouldBe "Public"
    resource.makePrivate(tid, session(ownerUid))
    resource.getTemplateType(tid) shouldBe "Private"
  }

  it should "reject a non-owner without access changing visibility" in {
    val tid = createOwnedTemplate(session(ownerUid))
    assertThrows[ForbiddenException] {
      resource.makePublic(tid, session(otherUid))
    }
  }

  "retrieveTemplate" should "let the owner open their own template" in {
    val tid = createOwnedTemplate(session(ownerUid))
    noException should be thrownBy resource.retrieveTemplate(tid, session(ownerUid))
  }

  it should "reject a non-owner opening a private template" in {
    val tid = createOwnedTemplate(session(ownerUid))
    assertThrows[ForbiddenException] {
      resource.retrieveTemplate(tid, session(otherUid))
    }
  }

  it should "let a non-owner open a public template" in {
    val tid = createOwnedTemplate(session(ownerUid))
    resource.makePublic(tid, session(ownerUid))
    noException should be thrownBy resource.retrieveTemplate(tid, session(otherUid))
  }

  "retrieveTemplates" should "list the user's own templates but not another user's private ones" in {
    val ownerTid = createOwnedTemplate(session(ownerUid))
    val ownerTids = resource.retrieveTemplates(session(ownerUid)).map(_("tid"))
    ownerTids should contain(ownerTid)
    // the other user must not see the owner's private template
    val otherTids = resource.retrieveTemplates(session(otherUid)).map(_("tid"))
    otherTids should not contain ownerTid
  }

  "duplicateTemplate" should "let a non-owner clone a PUBLIC template" in {
    val tid = createOwnedTemplate(session(ownerUid))
    resource.makePublic(tid, session(ownerUid))
    val copies = resource.duplicateTemplate(TemplateResource.TemplateIDs(List(tid)), session(otherUid))
    copies should have size 1
  }

  it should "reject a non-owner cloning a PRIVATE template" in {
    val tid = createOwnedTemplate(session(ownerUid))
    assertThrows[ForbiddenException] {
      resource.duplicateTemplate(TemplateResource.TemplateIDs(List(tid)), session(otherUid))
    }
  }
}
