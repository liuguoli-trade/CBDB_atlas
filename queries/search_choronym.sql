SELECT
  c_choronym_code AS c_code,
  c_choronym_chn AS c_name_chn,
  c_choronym_desc AS c_name
FROM CHORONYM_CODES
WHERE (
  c_choronym_chn LIKE :pattern
  OR c_choronym_desc LIKE :pattern
  OR CAST(c_choronym_code AS TEXT) = :exact_id
)
ORDER BY c_choronym_chn
LIMIT :limit OFFSET :offset;
