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

import com.fasterxml.jackson.databind.{JsonNode, ObjectMapper}
import com.fasterxml.jackson.databind.node.ObjectNode
import org.apache.texera.amber.operator.LogicalOp

// The inner subgraph of a macro: inner operators (including MacroInputOp /
// MacroOutputOp boundary markers), internal links, and the declared external
// port specs. Serialized as JSON inside MacroOpDesc.snapshot (for SNAPSHOT
// mode) or returned by MacroRegistry.fetch (for LIVE mode).
case class MacroBody(
    operators: List[LogicalOp],
    links: List[MacroLink],
    inputs: List[MacroPortSpec] = Nil,
    outputs: List[MacroPortSpec] = Nil
)

object MacroBody {
  // Bare tree mapper -- no Scala module needed for JsonNode surgery.
  private val treeMapper = new ObjectMapper()

  /**
    * Strip the frontend-only `configurableProperties` whitelist off every
    * operator node in a macro body JSON.
    *
    * `configurableProperties` records which operator properties the Generate
    * form exposes for filling. It rides inside the persisted macro content but
    * is meaningless to the compiler/engine, and the operator classes -- notably
    * the MacroInput/MacroOutput markers -- do not declare it. A strict Jackson
    * deserializer therefore throws UnrecognizedPropertyException on it, failing
    * the whole macro load (both LIVE registry fetch and SNAPSHOT embedding).
    *
    * Applied ONLY on the two macro parse/embed paths (DbMacroRegistry.fetch and
    * MacroResource.snapshotIntoInstance); the general workflow deserializer is
    * left untouched. Recurses so nested-macro snapshots are covered too.
    */
  def stripConfigurableProperties(json: String): String = {
    val root = treeMapper.readTree(json)
    stripNode(root)
    treeMapper.writeValueAsString(root)
  }

  private def stripNode(node: JsonNode): Unit = node match {
    case obj: ObjectNode =>
      if (obj.has("operatorType")) obj.remove("configurableProperties")
      obj.elements().forEachRemaining(stripNode)
    case arr if arr.isArray =>
      arr.elements().forEachRemaining(stripNode)
    case _ => ()
  }
}
