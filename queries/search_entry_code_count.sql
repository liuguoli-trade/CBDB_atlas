SELECT COUNT(*) AS total
FROM ENTRY_CODES
WHERE (
  c_entry_desc_chn LIKE :pattern
  OR c_entry_desc LIKE :pattern
  OR CAST(c_entry_code AS TEXT) = :exact_id
);
