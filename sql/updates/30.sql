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

\c texera_db

SET search_path TO texera_db;

BEGIN;

-- Parameterized Canvas: a second way to use the same workflow. When this flag is
-- on, the workflow additionally offers a form of the inputs its author chose to
-- expose plus a Run button, instead of only the operator canvas.
--
-- The form's definition (which properties are exposed, their display names, help
-- text, defaults, ordering, the instruction text, and which results to show)
-- lives in workflow.content under `parameterization`, so it travels with clone,
-- version and publish for free. Only this on/off flag is denormalized into a
-- column, so listing endpoints can render the entry point without parsing the
-- content TEXT of every row. Turning the flag off deliberately keeps the
-- definition in content, so toggling back on restores the previous setup.
ALTER TABLE workflow
    ADD COLUMN IF NOT EXISTS is_parameterized BOOLEAN NOT NULL DEFAULT false;

COMMIT;
