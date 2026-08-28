/**
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

package org.apache.texera.amber.operator.source.parameter

import org.apache.texera.amber.util.JSONUtils.objectMapper
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

/**
  * `datasetPairs` carries a dataset the downstream operators write into, picked from the
  * dataset browser rather than typed: the property panel renders any field named
  * `datasetVersionPath` as that picker.
  */
class DatasetPairsSpec extends AnyFlatSpec with Matchers {

  private def exec(props: String): List[List[Any]] =
    new ParameterSourceOpExec(props).produceTuple().map(_.getFields.toList).toList

  "ParameterSourceOpDesc" should "keep datasetPairs through a Jackson round trip" in {
    val props =
      """{"operatorType":"FileParameter",
        | "filePairs":[{"fileKey":"input","fileName":"/bob/ds/v1/x.tar"}],
        | "datasetPairs":[{"datasetKey":"publish_to","datasetVersionPath":"/bob/out/v2"}],
        | "pairs":[{"key":"seed","value":"42"}]}""".stripMargin

    val desc = objectMapper.readValue(props, classOf[ParameterSourceOpDesc])
    desc.datasetPairs should have size 1
    desc.datasetPairs.get(0).datasetKey shouldBe "publish_to"
    desc.datasetPairs.get(0).datasetVersionPath shouldBe Some("/bob/out/v2")

    // Re-serialising is not cosmetic: the descriptor is handed to the executor as the
    // JSON string this call produces, so a property that survives reading but not
    // writing reaches the operator as nothing at all.
    val back = objectMapper.readValue(objectMapper.writeValueAsString(desc), classOf[ParameterSourceOpDesc])
    back.datasetPairs.get(0).datasetVersionPath shouldBe Some("/bob/out/v2")
  }

  "ParameterSourceOpExec" should "emit one row per dataset pair, after the files and before the strings" in {
    val rows = exec(
      """{"operatorType":"FileParameter",
        | "filePairs":[{"fileKey":"input","fileName":"/bob/ds/v1/x.tar"}],
        | "datasetPairs":[{"datasetKey":"publish_to","datasetVersionPath":"/bob/out/v2"}],
        | "pairs":[{"key":"seed","value":"42"}]}""".stripMargin
    )
    rows shouldBe List(
      List("input", "/bob/ds/v1/x.tar"),
      List("publish_to", "/bob/out/v2"),
      List("seed", "42")
    )
  }

  it should "emit an empty value for a dataset pair whose dataset was never picked" in {
    // What a row added with `+` looks like before anyone opens the picker. The
    // consumer reads this as "not configured" and skips; an exception here would
    // fail the whole run over an optional setting.
    val rows = exec("""{"operatorType":"FileParameter","datasetPairs":[{"datasetKey":"publish_to"}]}""")
    rows shouldBe List(List("publish_to", ""))
  }

  it should "emit nothing when datasetPairs is absent" in {
    // Every workflow authored before this property existed.
    val rows = exec("""{"operatorType":"FileParameter","pairs":[{"key":"seed","value":"42"}]}""")
    rows shouldBe List(List("seed", "42"))
  }
}
