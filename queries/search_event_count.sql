SELECT COUNT(*) AS total
FROM EVENT_CODES
WHERE (
  c_event_name_chn LIKE :pattern
  OR c_event_name LIKE :pattern
  OR CAST(c_event_code AS TEXT) = :exact_id
);
