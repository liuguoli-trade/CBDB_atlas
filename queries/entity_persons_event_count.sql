SELECT COUNT(DISTINCT c_personid) AS total
FROM View_EventData
WHERE c_event_code = :entity_id;
