SELECT
  c_addr_id,
  c_name_chn,
  c_name,
  c_firstyear,
  c_lastyear,
  c_admin_type
FROM ADDR_CODES
WHERE (
  c_name_chn LIKE :pattern
  OR c_name LIKE :pattern
  OR c_alt_names LIKE :pattern
  OR CAST(c_addr_id AS TEXT) = :exact_id
)
ORDER BY
  CASE WHEN c_name_chn = :exact THEN 0
       WHEN c_name_chn LIKE :exact_prefix THEN 1
       ELSE 2 END,
  c_name_chn
LIMIT :limit OFFSET :offset;
