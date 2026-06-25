SELECT
  a.c_addr_id,
  a.c_name_chn,
  a.c_name,
  a.c_admin_type,
  a.c_firstyear,
  a.c_lastyear
FROM ADDR_BELONGS_DATA b
JOIN ADDR_CODES a ON a.c_addr_id = b.c_addr_id
WHERE b.c_belongs_to = :parent_id
ORDER BY a.c_name_chn
LIMIT :limit OFFSET :offset;
