SELECT COUNT(*) AS total
FROM ASSOC_CODES
WHERE (
  c_assoc_desc_chn LIKE :pattern
  OR c_assoc_desc LIKE :pattern
  OR CAST(c_assoc_code AS TEXT) = :exact_id
);
