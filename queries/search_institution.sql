SELECT
  c_inst_name_code,
  c_inst_name_hz,
  c_inst_name_py
FROM SOCIAL_INSTITUTION_NAME_CODES
WHERE (
  c_inst_name_hz LIKE :pattern
  OR c_inst_name_py LIKE :pattern
  OR CAST(c_inst_name_code AS TEXT) = :exact_id
)
ORDER BY
  CASE WHEN c_inst_name_hz = :exact THEN 0
       WHEN c_inst_name_hz LIKE :exact_prefix THEN 1
       ELSE 2 END,
  c_inst_name_hz
LIMIT :limit OFFSET :offset;
