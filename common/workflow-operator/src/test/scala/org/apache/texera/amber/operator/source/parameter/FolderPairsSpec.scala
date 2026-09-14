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
  * `folderPairs` carries a directory inside a dataset version, picked from the dataset
  * browser rather than typed: the property panel renders any field named `folderPath`
  * as that picker. The value is passed through verbatim; whether it names a directory
  * or the version root is the consumer's business.
  */
class FolderPairsSpec extends AnyFlatSpec with Matchers {

  private def exec(props: String): List[List[Any]] =
    new ParameterSourceOpExec(props).produceTuple().map(_.getFields.toList).toList

  "ParameterSourceOpDesc" should "keep folderPairs through a Jackson round trip" in {
    val props =
      """{"operatorType":"FileParameter",
        | "folderPairs":[{"folderKey":"cellranger_dir","folderPath":"/bob/ds/v1/sample_a"}]}""".stripMargin
    val desc = objectMapper.readValue(props, classOf[ParameterSourceOpDesc])
    desc.folderPairs should have size 1
    desc.folderPairs.get(0).folderKey shouldBe "cellranger_dir"
    desc.folderPairs.get(0).folderPath shouldBe Some("/bob/ds/v1/sample_a")
    // The descriptor reaches the executor as the JSON this call produces, so a property
    // that survives reading but not writing arrives as nothing at all.
    val back =
      objectMapper.readValue(objectMapper.writeValueAsString(desc), classOf[ParameterSourceOpDesc])
    back.folderPairs.get(0).folderPath shouldBe Some("/bob/ds/v1/sample_a")
  }

  "ParameterSourceOpExec" should "emit one row per folder pair, after the files and before the datasets" in {
    val rows = exec(
      """{"operatorType":"FileParameter",
        | "filePairs":[{"fileKey":"input","fileName":"/bob/ds/v1/x.tar"}],
        | "folderPairs":[{"folderKey":"cellranger_dir","folderPath":"/bob/ds/v1/sample_a"}],
        | "datasetPairs":[{"datasetKey":"publish_to","datasetVersionPath":"/bob/out/v2"}],
        | "pairs":[{"key":"seed","value":"42"}]}""".stripMargin
    )
    rows shouldBe List(
      List("input", "/bob/ds/v1/x.tar"),
      List("cellranger_dir", "/bob/ds/v1/sample_a"),
      List("publish_to", "/bob/out/v2"),
      List("seed", "42")
    )
  }

  it should "pass a version root through unchanged when no folder below it was picked" in {
    // The picker pre-selects the version itself; a reader who wants everything in it
    // confirms without clicking a folder.
    val rows = exec(
      """{"operatorType":"FileParameter","folderPairs":[{"folderKey":"cellranger_dir","folderPath":"/bob/ds/v1"}]}"""
    )
    rows shouldBe List(List("cellranger_dir", "/bob/ds/v1"))
  }

  it should "emit an empty value for a folder pair whose folder was never picked" in {
    // A row added with `+` before anyone opens the picker. The consumer reads this as
    // "not configured"; an exception here would fail the run over an optional setting.
    val rows =
      exec("""{"operatorType":"FileParameter","folderPairs":[{"folderKey":"cellranger_dir"}]}""")
    rows shouldBe List(List("cellranger_dir", ""))
  }

  it should "emit nothing when folderPairs is absent" in {
    // Every workflow authored before this property existed.
    val rows = exec("""{"operatorType":"FileParameter","pairs":[{"key":"seed","value":"42"}]}""")
    rows shouldBe List(List("seed", "42"))
  }
}
