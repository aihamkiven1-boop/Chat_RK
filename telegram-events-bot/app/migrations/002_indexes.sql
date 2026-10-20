-- 002_indexes.sql
-- Secondary indexes and partial unique indexes for business constraints.

-- Lookup of events per group by status.
CREATE INDEX IF NOT EXISTS idx_events_chat_status
    ON events (chat_id, status);

-- Questions ordered per event.
CREATE INDEX IF NOT EXISTS idx_questions_event_order
    ON questions (event_id, order_number);

-- Answers by event.
CREATE INDEX IF NOT EXISTS idx_answers_event
    ON answers (event_id);

-- Answers by question run.
CREATE INDEX IF NOT EXISTS idx_answers_run
    ON answers (question_run_id);

-- Leaderboard per group.
CREATE INDEX IF NOT EXISTS idx_group_members_points
    ON group_members (chat_id, total_points DESC);

-- Leaderboard per event.
CREATE INDEX IF NOT EXISTS idx_event_scores_points
    ON event_scores (event_id, points DESC);

-- Only one ACTIVE event per group at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_one_active_per_group
    ON events (chat_id)
    WHERE status IN ('DRAFT', 'REGISTRATION', 'RUNNING');

-- Only one ACTIVE question run per event at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_question_runs_one_active_per_event
    ON question_runs (event_id)
    WHERE status = 'ACTIVE';
