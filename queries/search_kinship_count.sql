SELECT COUNT(*) AS total
FROM KINSHIP_CODES
WHERE (
  c_kinrel_chn LIKE :pattern
  OR c_kinrel LIKE :pattern
  OR CAST(c_kincode AS TEXT) = :exact_id
);
