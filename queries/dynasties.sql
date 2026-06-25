SELECT
  d.c_dy AS code,
  d.c_dynasty_chn AS label_chn,
  d.c_start AS start_year,
  d.c_end AS end_year,
  COUNT(p.c_personid) AS person_count
FROM DYNASTIES d
INNER JOIN View_PeopleData p ON p.c_dy = d.c_dy
GROUP BY d.c_dy, d.c_dynasty_chn, d.c_start, d.c_end, d.c_sort
ORDER BY CASE WHEN d.c_dy = 0 THEN 1 ELSE 0 END,
         COALESCE(NULLIF(d.c_sort, 0), d.c_start, d.c_dy)
LIMIT :limit;
