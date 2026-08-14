package org.apache.texera.amber.operator.source.parameter

import org.apache.texera.amber.util.JSONUtils.objectMapper
import org.scalatest.flatspec.AnyFlatSpec
import java.io.{PrintWriter, StringWriter}
import java.nio.file.{Files, Paths}

class ParamRoundTripSpec extends AnyFlatSpec {
  "ParameterSourceOpDesc" should "keep its pairs through Jackson" in {
    val props =
      """{"operatorType":"FileParameter","filePairs":[{"fileKey":"file_path","fileName":"/texera/ddx41/v1/x.h5ad"}],"pairs":[{"key":"n_hvg","value":"1500"}]}"""
    val sb = new StringBuilder
    try {
      val desc = objectMapper.readValue(props, classOf[org.apache.texera.amber.operator.LogicalOp]).asInstanceOf[ParameterSourceOpDesc]
      sb.append("read OK  filePairs=" + desc.filePairs.size + " pairs=" + desc.pairs.size + "\n")
      val out = objectMapper.writeValueAsString(desc)
      sb.append("reserialized: " + out + "\n")
      val back = objectMapper.readValue(out, classOf[ParameterSourceOpDesc])
      sb.append("2nd read filePairs=" + back.filePairs.size + " pairs=" + back.pairs.size + "\n")
    } catch {
      case e: Throwable =>
        val sw = new StringWriter
        e.printStackTrace(new PrintWriter(sw))
        sb.append("EXCEPTION:\n" + sw.toString.take(2500))
    }
    Files.write(Paths.get("/tmp/rt-result.txt"), sb.toString.getBytes)
  }
}
