SELECT
  c_event_code,
  c_event_name_chn,
  c_event_name,
  c_fy_yr,
  c_ly_yr
FROM EVENT_CODES
WHERE (
  c_event_name_chn LIKE :pattern
  OR c_event_name LIKE :pattern
  OR CAST(c_event_code AS TEXT) = :exact_id
)
ORDER BY
  CASE WHEN c_event_name_chn = :exact THEN 0
       WHEN c_event_name_chn LIKE :exact_prefix THEN 1
       ELSE 2 END,
  c_event_name_chn
LIMIT :limit OFFSET :offset;
