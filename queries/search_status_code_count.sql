SELECT COUNT(*) AS total
FROM STATUS_CODES
WHERE (
  c_status_desc_chn LIKE :pattern
  OR c_status_desc LIKE :pattern
  OR CAST(c_status_code AS TEXT) = :exact_id
);
