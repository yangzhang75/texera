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

-- Make templates 1-to-n: a template can produce many workflows. Move the primary key from tid
-- (which forced one workflow per template) to wid (a workflow belongs to at most one template),
-- and keep tid as a non-unique NOT NULL foreign key so many rows may share the same tid.
ALTER TABLE workflow_of_template DROP CONSTRAINT workflow_of_template_pkey;
ALTER TABLE workflow_of_template DROP CONSTRAINT workflow_of_template_wid_key;
ALTER TABLE workflow_of_template ALTER COLUMN tid SET NOT NULL;
ALTER TABLE workflow_of_template ADD PRIMARY KEY (wid);

COMMIT;
