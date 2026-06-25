SELECT
  o.c_office_id,
  o.c_office_chn,
  o.c_office_pinyin,
  o.c_office_trans,
  o.c_dy,
  d.c_dynasty_chn
FROM OFFICE_CODES o
LEFT JOIN DYNASTIES d ON o.c_dy = d.c_dy
WHERE (
  o.c_office_chn LIKE :pattern
  OR o.c_office_pinyin LIKE :pattern
  OR o.c_office_trans LIKE :pattern
  OR o.c_office_chn_alt LIKE :pattern
  OR CAST(o.c_office_id AS TEXT) = :exact_id
)
ORDER BY
  CASE WHEN o.c_office_chn = :exact THEN 0
       WHEN o.c_office_chn LIKE :exact_prefix THEN 1
       ELSE 2 END,
  o.c_office_chn
LIMIT :limit OFFSET :offset;
