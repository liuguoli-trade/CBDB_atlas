SELECT
  c_kincode AS c_code,
  c_kinrel_chn AS c_name_chn,
  c_kinrel AS c_name
FROM KINSHIP_CODES
WHERE (
  c_kinrel_chn LIKE :pattern
  OR c_kinrel LIKE :pattern
  OR CAST(c_kincode AS TEXT) = :exact_id
)
ORDER BY c_kinrel_chn
LIMIT :limit OFFSET :offset;
