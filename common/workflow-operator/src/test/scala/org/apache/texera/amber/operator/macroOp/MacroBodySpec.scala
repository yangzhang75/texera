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

package org.apache.texera.amber.operator.macroOp

import com.fasterxml.jackson.databind.ObjectMapper
import org.apache.texera.amber.util.JSONUtils.objectMapper
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

/**
  * Guards MacroBody.stripConfigurableProperties -- the macro-parse-path defense
  * against the frontend-only `configurableProperties` whitelist. That field
  * rides inside persisted macro content but is not declared on the operator
  * classes (notably the MacroInput/MacroOutput markers), so a strict Jackson
  * deserializer throws UnrecognizedPropertyException on it and the whole macro
  * fails to load (both LIVE registry fetch and SNAPSHOT embedding). Stripping it
  * before the body is parsed for expansion is the fix.
  */
class MacroBodySpec extends AnyFlatSpec with Matchers {

  private val treeMapper = new ObjectMapper()

  // A macro body whose MacroOutput marker AND a real op both carry the stray
  // whitelist -- exactly the shape that crashed a LIVE nested-macro run.
  private val dirtyBody: String =
    """{
      |  "operators": [
      |    {"operatorID":"in-0","operatorType":"MacroInput","portIndex":0},
      |    {"operatorID":"limit-1","operatorType":"Limit","limit":5,"configurableProperties":["limit"]},
      |    {"operatorID":"out-2","operatorType":"MacroOutput","portIndex":0,"configurableProperties":["portIndex"]}
      |  ],
      |  "links": [],
      |  "inputs": [{"index":0}],
      |  "outputs": [{"index":0}]
      |}""".stripMargin

  "stripConfigurableProperties" should "remove the field from every operator (markers and real ops)" in {
    val cleaned = treeMapper.readTree(MacroBody.stripConfigurableProperties(dirtyBody))
    val ops = cleaned.get("operators")
    (0 until ops.size()).foreach { i =>
      ops.get(i).has("configurableProperties") shouldBe false
    }
  }

  it should "leave all other operator fields and body structure intact" in {
    val cleaned = treeMapper.readTree(MacroBody.stripConfigurableProperties(dirtyBody))
    val limit = cleaned.get("operators").get(1)
    limit.get("operatorType").asText() shouldBe "Limit"
    limit.get("limit").asInt() shouldBe 5
    cleaned.get("links").size() shouldBe 0
    cleaned.get("inputs").get(0).get("index").asInt() shouldBe 0
    cleaned.get("outputs").get(0).get("index").asInt() shouldBe 0
  }

  it should "make a body that a strict deserializer previously rejected parse cleanly" in {
    // Reproduces the exact crash: the raw dirty body throws on the marker field...
    assertThrows[Exception] {
      objectMapper.readValue(dirtyBody, classOf[MacroBody])
    }
    // ...and the sanitized body deserializes without error.
    val body = objectMapper.readValue(MacroBody.stripConfigurableProperties(dirtyBody), classOf[MacroBody])
    body.operators should have size 3
    body.inputs.map(_.index) shouldBe List(0)
    body.outputs.map(_.index) shouldBe List(0)
  }

  it should "recurse into a nested-macro embedded snapshot" in {
    val nested =
      """{
        |  "operators": [
        |    {"operatorID":"m-0","operatorType":"Macro","linkMode":"SNAPSHOT","snapshot":{
        |       "operators":[{"operatorID":"o","operatorType":"MacroOutput","portIndex":0,"configurableProperties":["portIndex"]}],
        |       "links":[],"inputs":[],"outputs":[{"index":0}]
        |    }}
        |  ],
        |  "links": [], "inputs": [], "outputs": []
        |}""".stripMargin
    val cleaned = treeMapper.readTree(MacroBody.stripConfigurableProperties(nested))
    val innerOp = cleaned.get("operators").get(0).get("snapshot").get("operators").get(0)
    innerOp.has("configurableProperties") shouldBe false
  }
}
