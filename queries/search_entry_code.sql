SELECT
  c_entry_code AS c_code,
  c_entry_desc_chn AS c_name_chn,
  c_entry_desc AS c_name
FROM ENTRY_CODES
WHERE (
  c_entry_desc_chn LIKE :pattern
  OR c_entry_desc LIKE :pattern
  OR CAST(c_entry_code AS TEXT) = :exact_id
)
ORDER BY c_entry_desc_chn
LIMIT :limit OFFSET :offset;
