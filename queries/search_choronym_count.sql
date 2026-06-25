SELECT COUNT(*) AS total
FROM CHORONYM_CODES
WHERE (
  c_choronym_chn LIKE :pattern
  OR c_choronym_desc LIKE :pattern
  OR CAST(c_choronym_code AS TEXT) = :exact_id
);
