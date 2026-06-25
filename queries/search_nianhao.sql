SELECT
  c_nianhao_id AS c_code,
  c_nianhao_chn AS c_name_chn,
  c_nianhao_pin AS c_name,
  c_dynasty_chn,
  c_firstyear,
  c_lastyear
FROM NIAN_HAO
WHERE (
  c_nianhao_chn LIKE :pattern
  OR c_nianhao_pin LIKE :pattern
  OR CAST(c_nianhao_id AS TEXT) = :exact_id
)
ORDER BY c_firstyear DESC, c_nianhao_chn
LIMIT :limit OFFSET :offset;
