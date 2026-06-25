SELECT DISTINCT
  p.c_personid,
  p.c_name_chn,
  p.c_name,
  p.c_dynasty_chn,
  p.c_birthyear,
  p.c_deathyear,
  e.c_event_name_chn,
  e.c_year,
  '生平事件' AS relation
FROM View_EventData e
JOIN View_PeopleData p ON p.c_personid = e.c_personid
WHERE e.c_event_code = :entity_id
ORDER BY e.c_year DESC, p.c_name_chn
LIMIT :limit OFFSET :offset;
