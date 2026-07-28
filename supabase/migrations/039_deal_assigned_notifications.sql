-- ============================================================
-- 039_deal_assigned_notifications.sql
--
-- Notify a team member when a DEAL (pipeline card) is assigned to
-- them — mirroring the existing conversation-assignment notification
-- (migration 027). Also localises the notification title/body to
-- Portuguese for this PT-BR deployment.
--
--   1. Allow the new `deal_assigned` notification type.
--   2. Add a nullable `deal_id` so the app can deep-link to the funnel.
--   3. Trigger on deals.assigned_to → insert a notification for the
--      assigned member (mapping profiles.id → profiles.user_id, since
--      deals.assigned_to references profiles.id but notifications.user_id
--      is an auth.users id).
--   4. Re-localise the conversation-assignment text to PT for consistency.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1) Allow the new type value.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'deal_assigned'));

-- 2) Optional link target for deal notifications.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE;

-- 3) Trigger: notify on deal assignment.
CREATE OR REPLACE FUNCTION notify_deal_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient    UUID;
  v_contact_name TEXT;
  v_actor_name   TEXT;
BEGIN
  -- Only fire when there is an assignee, and (on UPDATE) it changed.
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_to IS NULL
       OR NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
      RETURN NEW;
    END IF;
  END IF;

  -- deals.assigned_to references profiles.id; the notification recipient
  -- must be the profile's auth user id.
  SELECT user_id INTO v_recipient
  FROM profiles WHERE id = NEW.assigned_to;
  IF v_recipient IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip self-assignment.
  IF auth.uid() IS NOT NULL AND auth.uid() = v_recipient THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, deal_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    v_recipient,
    'deal_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'Novo negócio atribuído',
    COALESCE(v_actor_name, 'Alguém') || ' atribuiu a você o negócio "'
      || COALESCE(NULLIF(NEW.title, ''), 'sem título') || '"'
      || CASE WHEN v_contact_name IS NOT NULL
              THEN ' (contato: ' || v_contact_name || ')' ELSE '' END
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create deal assignment notification for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_deal_assigned() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_assigned ON deals;
CREATE TRIGGER on_deal_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON deals
  FOR EACH ROW EXECUTE FUNCTION notify_deal_assigned();

-- 4) Localise the conversation-assignment text to PT (consistency).
CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'Nova conversa atribuída',
    COALESCE(v_actor_name, 'Alguém') || ' atribuiu a você uma conversa com '
      || COALESCE(v_contact_name, 'um contato')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;
