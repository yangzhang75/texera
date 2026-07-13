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

-- Status of a content-moderation report against a public workflow.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'report_status_enum'
    ) THEN
        CREATE TYPE report_status_enum AS ENUM ('PENDING', 'CLOSED', 'ACTIONED');
    END IF;
END
$$;

-- Content-moderation reports filed by users against public workflows.
CREATE TABLE IF NOT EXISTS workflow_report
(
    report_id       SERIAL PRIMARY KEY,
    wid             INT NOT NULL,
    reporter_uid    INT NOT NULL,
    reason          VARCHAR(64) NOT NULL,
    detail          TEXT,
    status          report_status_enum NOT NULL DEFAULT 'PENDING',
    resolver_uid    INT,
    creation_time   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_time   TIMESTAMP,
    FOREIGN KEY (wid) REFERENCES workflow(wid) ON DELETE CASCADE,
    FOREIGN KEY (reporter_uid) REFERENCES "user"(uid) ON DELETE CASCADE,
    FOREIGN KEY (resolver_uid) REFERENCES "user"(uid) ON DELETE SET NULL
);

COMMIT;
