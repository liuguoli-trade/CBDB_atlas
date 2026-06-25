SELECT
  o.c_office_id,
  o.c_office_chn,
  o.c_office_pinyin,
  o.c_office_trans,
  d.c_dynasty_chn
FROM OFFICE_CODE_TYPE_REL r
JOIN OFFICE_CODES o ON o.c_office_id = r.c_office_id
LEFT JOIN DYNASTIES d ON d.c_dy = o.c_dy
WHERE r.c_office_tree_id = :node_id
ORDER BY o.c_office_chn
LIMIT :limit OFFSET :offset;
