SELECT COUNT(*) AS total
FROM ADDR_CODES
WHERE (
  c_name_chn LIKE :pattern
  OR c_name LIKE :pattern
  OR c_alt_names LIKE :pattern
  OR CAST(c_addr_id AS TEXT) = :exact_id
);
