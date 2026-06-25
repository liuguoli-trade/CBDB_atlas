SELECT
  c_assoc_code AS c_code,
  c_assoc_desc_chn AS c_name_chn,
  c_assoc_desc AS c_name
FROM ASSOC_CODES
WHERE (
  c_assoc_desc_chn LIKE :pattern
  OR c_assoc_desc LIKE :pattern
  OR CAST(c_assoc_code AS TEXT) = :exact_id
)
ORDER BY c_assoc_desc_chn
LIMIT :limit OFFSET :offset;
