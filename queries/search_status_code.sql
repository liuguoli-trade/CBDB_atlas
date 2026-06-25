SELECT
  c_status_code AS c_code,
  c_status_desc_chn AS c_name_chn,
  c_status_desc AS c_name
FROM STATUS_CODES
WHERE (
  c_status_desc_chn LIKE :pattern
  OR c_status_desc LIKE :pattern
  OR CAST(c_status_code AS TEXT) = :exact_id
)
ORDER BY c_status_desc_chn
LIMIT :limit OFFSET :offset;
