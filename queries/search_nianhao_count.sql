SELECT COUNT(*) AS total
FROM NIAN_HAO
WHERE (
  c_nianhao_chn LIKE :pattern
  OR c_nianhao_pin LIKE :pattern
  OR CAST(c_nianhao_id AS TEXT) = :exact_id
);
