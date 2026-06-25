SELECT COUNT(DISTINCT e.c_personid) AS total
FROM View_EventData e
WHERE (
  e.c_event_name_chn LIKE :pattern
  OR e.c_event_name LIKE :pattern
  OR CAST(e.c_event_code AS TEXT) = :exact_id
)
AND (:year_min IS NULL OR e.c_year >= :year_min)
AND (:year_max IS NULL OR e.c_year <= :year_max);
