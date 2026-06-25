SELECT DISTINCT
  p.c_personid,
  p.c_name_chn,
  p.c_name,
  p.c_dynasty_chn,
  p.c_birthyear,
  p.c_deathyear,
  e.c_event_name_chn,
  e.c_year
FROM View_EventData e
JOIN View_PeopleData p ON p.c_personid = e.c_personid
WHERE (
  e.c_event_name_chn LIKE :pattern
  OR e.c_event_name LIKE :pattern
  OR CAST(e.c_event_code AS TEXT) = :exact_id
)
AND (:year_min IS NULL OR e.c_year >= :year_min)
AND (:year_max IS NULL OR e.c_year <= :year_max)
ORDER BY e.c_year DESC, p.c_name_chn
LIMIT :limit OFFSET :offset;
